// Teste POST /api/transfers sur l'app réelle, avec un stockage en mémoire et Transfer.create remplacé :
// les tests unitaires n'ont pas de MongoDB (la vraie base est couverte par les tests d'intégration, T3.2).
import request from "supertest";
import { createApp } from "../../src/app.js";
import { CODE_ALPHABET, CODE_LENGTH, TRANSFER_TTL_MS } from "../../src/configs/limits.js";
import { Transfer } from "../../src/models/transfer.model.js";
import { createMemoryStorage, type MemoryStorage } from "../helpers/memory-storage.js";

type TransferInput = {
  code: string;
  expiresAt: Date;
  maxDownloads: number;
  files: { originalName: string; sizeBytes: number; storageKey: string; contentType?: string }[];
};

// Remplace Transfer.create le temps d'un test : l'implémentation reçoit le document que le contrôleur insère.
const originalCreate = Transfer.create;
let inserted: TransferInput[] = [];
function stubCreate(implementation: (doc: TransferInput) => Promise<unknown>) {
  Transfer.create = (async (doc: TransferInput) => {
    inserted.push(doc);
    return implementation(doc);
  }) as unknown as typeof Transfer.create;
}

let logged: unknown[][] = [];
const originalConsoleError = console.error;
beforeEach(() => {
  inserted = [];
  logged = [];
  console.error = (...args: unknown[]) => logged.push(args);
});
afterEach(() => {
  Transfer.create = originalCreate;
  console.error = originalConsoleError;
});

function postTwoFiles(storage: MemoryStorage) {
  return request(createApp({ storage }))
    .post("/api/transfers")
    .attach("files", Buffer.from("contenu A"), "a.txt")
    .attach("files", Buffer.from("contenu B"), "b.png");
}

describe("POST /api/transfers", () => {
  it("crée le transfert et répond 201 { code, expiresAt }", async () => {
    stubCreate(async (doc) => doc);
    const storage = createMemoryStorage();

    const response = await postTwoFiles(storage);

    expect(response.status).toBe(201);
    expect(Object.keys(response.body).sort()).toEqual(["code", "expiresAt"]);
    expect(response.body.code).toHaveLength(CODE_LENGTH);
    expect([...response.body.code].every((char) => CODE_ALPHABET.includes(char))).toBe(true);
    const expiresIn = new Date(response.body.expiresAt).getTime() - Date.now();
    expect(Math.abs(expiresIn - TRANSFER_TTL_MS)).toBeLessThan(5_000);
  });

  it("enregistre en base les métadonnées des fichiers réellement stockés", async () => {
    stubCreate(async (doc) => doc);
    const storage = createMemoryStorage();

    await postTwoFiles(storage);

    const [doc] = inserted;
    expect(doc?.maxDownloads).toBe(1);
    expect(doc?.files.map(({ originalName, sizeBytes }) => ({ originalName, sizeBytes }))).toEqual([
      { originalName: "a.txt", sizeBytes: 9 },
      { originalName: "b.png", sizeBytes: 9 },
    ]);
    for (const file of doc?.files ?? []) expect(storage.objects.has(file.storageKey)).toBe(true);
  });

  it("retire un nouveau code si l'index unique refuse le premier (E11000)", async () => {
    let calls = 0;
    stubCreate(async (doc) => {
      calls++;
      if (calls === 1)
        throw Object.assign(new Error("E11000 duplicate key"), { code: 11000, keyPattern: { code: 1 } });
      return doc;
    });
    const storage = createMemoryStorage();

    const response = await postTwoFiles(storage);

    expect(response.status).toBe(201);
    expect(calls).toBe(2);
    expect(storage.objects.size).toBe(2);
  });

  it("compense un échec de la base : 500 et suppression des fichiers déjà envoyés", async () => {
    stubCreate(async () => {
      throw new Error("MongoDB injoignable");
    });
    const storage = createMemoryStorage();

    const response = await postTwoFiles(storage);

    expect(response.status).toBe(500);
    expect(storage.deletedKeys).toHaveLength(2);
    expect(storage.objects.size).toBe(0);
  });

  it("journalise les objets restés orphelins si la compensation échoue elle aussi", async () => {
    stubCreate(async () => {
      throw new Error("MongoDB injoignable");
    });
    const storage = createMemoryStorage();
    storage.deleteObjects = async (keys) => ({
      deleted: 0,
      failed: keys.map((key) => ({ key, reason: "S3 injoignable" })),
    });

    const response = await postTwoFiles(storage);

    expect(response.status).toBe(500);
    const compensationLog = logged.find(([message]) => String(message).includes("Compensation incomplète"));
    expect(compensationLog?.[1]).toHaveLength(2);
  });

  it.each([
    ["sans corps", undefined],
    ["en JSON", { files: ["a.txt"] }],
  ])("répond 400 à une requête %s, sans fichier", async (_label, body) => {
    const response = await request(createApp({ storage: createMemoryStorage() }))
      .post("/api/transfers")
      .send(body);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Aucun fichier reçu : ajoutez au moins un fichier." });
  });
});
