// Teste GET /api/transfers/:code/download sur l'app réelle, avec un stockage en mémoire et les requêtes Mongo
// remplacées (pas de base en tests unitaires) : on vérifie ce que le contrôleur demande à Mongo et ce qu'il répond.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { Transfer } from "../../src/models/transfer.model.js";
import { createMemoryStorage, type MemoryStorage } from "../helpers/memory-storage.js";

const CODE = "ABCD2345";
const URL = `/api/transfers/${CODE}/download`;

type Method = "findOneAndUpdate" | "findOne" | "updateOne";
const originals = {
  findOneAndUpdate: Transfer.findOneAndUpdate,
  findOne: Transfer.findOne,
  updateOne: Transfer.updateOne,
};
let calls: Record<Method, unknown[][]>;

// Remplace une méthode du modèle le temps d'un test et enregistre les arguments reçus.
function stub(method: Method, implementation: () => Promise<unknown>) {
  (Transfer as unknown as Record<Method, unknown>)[method] = async (...args: unknown[]) => {
    calls[method].push(args);
    return implementation();
  };
}

const reservedTransfer = {
  _id: "transfer-id",
  code: CODE,
  files: [
    { originalName: "a.txt", storageKey: "uploads/a.txt" },
    { originalName: "b.txt", storageKey: "uploads/b.txt" },
  ],
};

let storage: MemoryStorage;
let logged: unknown[][] = [];
const originalConsoleError = console.error;

beforeEach(() => {
  calls = { findOneAndUpdate: [], findOne: [], updateOne: [] };
  stub("findOneAndUpdate", async () => reservedTransfer);
  stub("findOne", async () => null);
  stub("updateOne", async () => ({ modifiedCount: 1 }));
  storage = createMemoryStorage();
  storage.objects.set("uploads/a.txt", Buffer.from("contenu A"));
  storage.objects.set("uploads/b.txt", Buffer.from("contenu B"));
  logged = [];
  console.error = (...args: unknown[]) => logged.push(args);
});
afterEach(() => {
  Object.assign(Transfer, originals);
  console.error = originalConsoleError;
});

// La réservation a-t-elle été rendue ($inc: -1) ?
const released = () =>
  calls.updateOne.some(([, update]) => JSON.stringify(update) === '{"$inc":{"downloadCount":-1}}');

describe("GET /api/transfers/:code/download", () => {
  it("envoie un ZIP avec les bons en-têtes", async () => {
    const response = await request(createApp({ storage })).get(URL).responseType("blob");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("application/zip");
    expect(response.headers["content-disposition"]).toBe(`attachment; filename="fastshare-${CODE}.zip"`);
    expect(response.headers["cache-control"]).toBe("no-store");
    const body = response.body as Buffer;
    expect(body.subarray(0, 2).toString()).toBe("PK");
    expect(body.includes("a.txt") && body.includes("b.txt")).toBe(true);
    expect(released()).toBe(false);
  });

  it("réserve en une seule opération : condition (non expiré, quota non atteint) + incrément", async () => {
    await request(createApp({ storage })).get(URL).responseType("blob");

    const [filter, update, options] = calls.findOneAndUpdate[0] ?? [];
    expect(filter).toMatchObject({
      code: CODE,
      expiresAt: { $gt: expect.any(Date) },
      $expr: { $lt: ["$downloadCount", "$maxDownloads"] },
    });
    expect(update).toEqual({ $inc: { downloadCount: 1 } });
    expect(options).toEqual({ returnDocument: "after" });
  });

  it("accepte un code saisi en minuscules", async () => {
    await request(createApp({ storage }))
      .get(`/api/transfers/${CODE.toLowerCase()}/download`)
      .responseType("blob");

    expect(calls.findOneAndUpdate[0]?.[0]).toMatchObject({ code: CODE });
  });

  it.each(["ABC", "ABCD2340", "ABCD23456"])(
    "répond 404 au code mal formé %s sans interroger la base",
    async (code) => {
      const response = await request(createApp({ storage })).get(`/api/transfers/${code}/download`);

      expect(response.status).toBe(404);
      expect(calls.findOneAndUpdate).toHaveLength(0);
    },
  );

  it("répond 404 à un code inconnu", async () => {
    stub("findOneAndUpdate", async () => null);

    const response = await request(createApp({ storage })).get(URL);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Code inconnu : vérifiez le code saisi." });
  });

  it.each([
    ["expiré", { expiresAt: new Date(Date.now() - 1000) }, "Ce transfert a expiré."],
    ["épuisé", { expiresAt: new Date(Date.now() + 60_000) }, "Ce transfert a déjà été téléchargé."],
  ])("répond 410 à un transfert %s", async (_label, existing, message) => {
    stub("findOneAndUpdate", async () => null);
    stub("findOne", async () => existing);

    const response = await request(createApp({ storage })).get(URL);

    expect(response.status).toBe(410);
    expect(response.body).toEqual({ error: message });
  });

  it("répond 410 en JSON si un objet manque dans le bucket, avant tout envoi", async () => {
    storage.objects.delete("uploads/b.txt");

    const response = await request(createApp({ storage })).get(URL);

    expect(response.status).toBe(410);
    expect(response.body.error).toMatch(/introuvables/);
    expect(String(logged[0]?.[0])).toContain("incomplet");
  });

  it("libère la réservation si le stockage est injoignable avant l'envoi (500)", async () => {
    storage.exists = async () => {
      throw new Error("S3 injoignable");
    };

    const response = await request(createApp({ storage })).get(URL);

    expect(response.status).toBe(500);
    expect(released()).toBe(true);
  });

  it("coupe la connexion et libère la réservation si un fichier échoue pendant l'envoi", async () => {
    storage.getStream = async () => {
      throw new Error("lecture S3 interrompue");
    };

    await expect(request(createApp({ storage })).get(URL)).rejects.toThrow();

    expect(released()).toBe(true);
  });

  it("libère la réservation si le client se déconnecte en plein téléchargement", async () => {
    // Fichier sans fin : le téléchargement est forcément en cours quand le client coupe.
    storage.getStream = async () =>
      new Readable({
        read() {
          this.push(Buffer.alloc(64 * 1024));
        },
      });
    const server = http.createServer(createApp({ storage })).listen(0);
    const { port } = server.address() as AddressInfo;

    await new Promise<void>((resolve) => {
      const req = http.get(`http://localhost:${port}${URL}`, (res) => {
        res.once("data", () => {
          req.destroy();
          resolve();
        });
      });
      req.on("error", () => {});
    });
    for (let i = 0; i < 50 && !released(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
    server.close();

    expect(released()).toBe(true);
    // Départ du client : comportement normal, rien à journaliser.
    expect(logged).toHaveLength(0);
  });

  it("refuse HEAD (405) sans consommer le téléchargement", async () => {
    const response = await request(createApp({ storage })).head(URL);

    expect(response.status).toBe(405);
    expect(response.headers["allow"]).toBe("GET");
    expect(calls.findOneAndUpdate).toHaveLength(0);
  });
});
