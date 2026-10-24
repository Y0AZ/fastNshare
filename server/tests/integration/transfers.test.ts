// Tests d'intégration du cycle d'un transfert (envoi → téléchargement) contre un vrai MongoDB et un vrai S3.
import { randomBytes } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Express } from "express";
import request from "supertest";
import { Transfer } from "../../src/models/transfer.model.js";
import { readStoredZip } from "../helpers/read-zip.js";
import { createIntegrationContext, type IntegrationContext } from "./helpers/context.js";

const MiB = 1024 * 1024;
let ctx: IntegrationContext;

beforeAll(async () => {
  ctx = await createIntegrationContext("transfers");
});
beforeEach(async () => {
  await ctx.reset();
});
afterAll(async () => {
  await ctx.close();
});

function upload(app: Express, files: [name: string, content: Buffer][]) {
  let req = request(app).post("/api/transfers");
  for (const [name, content] of files) req = req.attach("files", content, name);
  return req;
}

const download = (app: Express, code: string) =>
  request(app).get(`/api/transfers/${code}/download`).responseType("blob");

async function createTransfer(app: Express, files: [string, Buffer][]): Promise<string> {
  const response = await upload(app, files).expect(201);
  return response.body.code as string;
}

describe("POST /api/transfers (vrai Mongo, vrai S3)", () => {
  it("enregistre le transfert : document en base et objets dans le bucket concordent", async () => {
    const response = await upload(ctx.app(), [
      ["a.txt", Buffer.from("bonjour")],
      ["photo.png", randomBytes(1000)],
    ]);

    expect(response.status).toBe(201);
    const transfer = await Transfer.findOne({ code: response.body.code }).lean();
    expect(transfer?.files.map(({ originalName, sizeBytes }) => ({ originalName, sizeBytes }))).toEqual([
      { originalName: "a.txt", sizeBytes: 7 },
      { originalName: "photo.png", sizeBytes: 1000 },
    ]);
    expect((await ctx.listObjectKeys()).sort()).toEqual(transfer?.files.map((f) => f.storageKey).sort());
  });

  it("répond 400 sans fichier, sans rien écrire", async () => {
    const response = await request(ctx.app()).post("/api/transfers");

    expect(response.status).toBe(400);
    expect(await Transfer.countDocuments()).toBe(0);
    expect(await ctx.listObjectKeys()).toEqual([]);
  });

  // 12 Mio > limite de test de 8 Mio : le fichier est déjà parti en multipart S3 (parties de 5 Mo) quand le
  // dépassement est détecté. Ni objet, ni multipart inachevé ne doivent rester, y compris le petit fichier déjà écrit.
  it("répond 413 à un fichier trop gros et ne laisse aucun orphelin dans le bucket", async () => {
    const response = await upload(ctx.app(), [
      ["petit.txt", Buffer.from("déjà écrit")],
      ["gros.bin", randomBytes(12 * MiB)],
    ]);

    expect(response.status).toBe(413);
    expect(await ctx.listObjectKeys()).toEqual([]);
    expect(await ctx.countIncompleteMultipartUploads()).toBe(0);
    expect(await Transfer.countDocuments()).toBe(0);
  });
});

describe("GET /api/transfers/:code/download (vrai Mongo, vrai S3)", () => {
  it("renvoie un ZIP dont chaque fichier est identique à l'original", async () => {
    const big = randomBytes(6 * MiB);
    const app = ctx.app();
    const code = await createTransfer(app, [
      ["Été à Noël.txt", Buffer.from("accent")],
      ["gros.bin", big],
      ["rapport.txt", Buffer.from("premier")],
      ["rapport.txt", Buffer.from("second")],
    ]);

    const response = await download(app, code);

    expect(response.status).toBe(200);
    const archive = response.body as Buffer;
    expect(Number(response.headers["content-length"])).toBe(archive.length);
    const files = readStoredZip(archive);
    expect([...files.keys()]).toEqual(["Été à Noël.txt", "gros.bin", "rapport.txt", "rapport (2).txt"]);
    expect(files.get("Été à Noël.txt")?.toString()).toBe("accent");
    expect(files.get("gros.bin")?.equals(big)).toBe(true);
    expect(files.get("rapport.txt")?.toString()).toBe("premier");
    expect(files.get("rapport (2).txt")?.toString()).toBe("second");
  });

  it("répond 410 au deuxième téléchargement", async () => {
    const app = ctx.app();
    const code = await createTransfer(app, [["a.txt", Buffer.from("x")]]);
    await download(app, code).expect(200);

    const response = await download(app, code);

    expect(response.status).toBe(410);
    expect(JSON.parse(response.body.toString())).toEqual({ error: "Ce transfert a déjà été téléchargé." });
  });

  it("répond 410 à un transfert expiré, sans consommer de téléchargement", async () => {
    const app = ctx.app();
    const code = await createTransfer(app, [["a.txt", Buffer.from("x")]]);
    await Transfer.updateOne({ code }, { expiresAt: new Date(Date.now() - 1000) });

    const response = await download(app, code);

    expect(response.status).toBe(410);
    expect(JSON.parse(response.body.toString())).toEqual({ error: "Ce transfert a expiré." });
    expect((await Transfer.findOne({ code }).lean())?.downloadCount).toBe(0);
  });

  it("répond 404 à un code inconnu", async () => {
    const response = await download(ctx.app(), "ABCDEFGH");

    expect(response.status).toBe(404);
  });

  // La garantie centrale du produit : la réservation est arbitrée par Mongo, pas par le serveur.
  it("ne laisse passer qu'un seul de plusieurs téléchargements simultanés", async () => {
    const app = ctx.app();
    const code = await createTransfer(app, [["a.bin", randomBytes(2 * MiB)]]);

    const responses = await Promise.all(Array.from({ length: 5 }, () => download(app, code)));

    expect(responses.map((r) => r.status).sort()).toEqual([200, 410, 410, 410, 410]);
    expect((await Transfer.findOne({ code }).lean())?.downloadCount).toBe(1);
  });

  it("répond 410 si les fichiers ont disparu du bucket (document « fantôme »)", async () => {
    const app = ctx.app();
    const code = await createTransfer(app, [["a.txt", Buffer.from("x")]]);
    const transfer = await Transfer.findOne({ code }).lean();
    await ctx.storage.deleteObjects(transfer?.files.map((f) => f.storageKey) ?? []);

    const response = await download(app, code);

    expect(response.status).toBe(410);
    expect(JSON.parse(response.body.toString()).error).toMatch(/introuvables/);
  });

  // Le décompte doit revenir à 0 EN BASE pour que le destinataire puisse réessayer.
  it("rend le téléchargement si le client coupe en cours de route", async () => {
    const app = ctx.app();
    const code = await createTransfer(app, [["gros.bin", randomBytes(6 * MiB)]]);
    const server = http.createServer(app).listen(0);
    const { port } = server.address() as AddressInfo;

    await new Promise<void>((resolve) => {
      const req = http.get(`http://localhost:${port}/api/transfers/${code}/download`, (res) => {
        res.once("data", () => {
          req.destroy();
          resolve();
        });
      });
      req.on("error", () => {});
    });
    let downloadCount: number | undefined = 1;
    for (let i = 0; i < 50 && downloadCount !== 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      downloadCount = (await Transfer.findOne({ code }).lean())?.downloadCount;
    }
    server.close();

    expect(downloadCount).toBe(0);
    await download(app, code).expect(200);
  });
});
