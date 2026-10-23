// Teste le job de nettoyage avec un stockage en mémoire et une fausse collection à la place de Mongo :
// ordre des suppressions, conservation en cas d'échec S3, pagination, délai de grâce.
import { Types } from "mongoose";
import { cleanupExpiredTransfers } from "../../src/jobs/cleanup.js";
import type { Storage } from "../../src/libs/storage.js";
import { Transfer } from "../../src/models/transfer.model.js";
import { createMemoryStorage, type MemoryStorage } from "../helpers/memory-storage.js";

type FakeTransfer = { _id: Types.ObjectId; files: { storageKey: string }[] };
type Filter = { expiresAt: { $lte: Date }; _id?: { $gt: Types.ObjectId } };

// Fausse collection : `find` applique la pagination (_id > dernier vu, limite), `deleteMany` retire les documents.
let collection: FakeTransfer[];
let events: string[];
let findFilters: Filter[];
let deleteFilters: unknown[];
const originals = { find: Transfer.find, deleteMany: Transfer.deleteMany };

function installFakeCollection() {
  (Transfer as unknown as Record<string, unknown>).find = async (
    filter: Filter,
    _projection: unknown,
    options: {
      limit: number;
    },
  ) => {
    findFilters.push(filter);
    // Garde-fou : une pagination cassée relirait sans fin les mêmes transferts. Sans cette erreur, le test
    // ne s'arrêterait jamais (la boucle n'attend que des promesses déjà résolues, le délai de Jest ne joue pas).
    if (findFilters.length > 50) throw new Error("boucle infinie : la pagination relit les mêmes transferts");
    const after = filter._id?.$gt.toHexString() ?? "";
    return collection.filter((t) => t._id.toHexString() > after).slice(0, options.limit);
  };
  (Transfer as unknown as Record<string, unknown>).deleteMany = async (filter: {
    _id: { $in: Types.ObjectId[] };
  }) => {
    deleteFilters.push(filter);
    events.push("documents supprimés");
    const ids = new Set(filter._id.$in.map((id) => id.toHexString()));
    const before = collection.length;
    collection = collection.filter((t) => !ids.has(t._id.toHexString()));
    return { deletedCount: before - collection.length };
  };
}

// Transfert expiré dont les objets existent dans le stockage (ObjectId croissants, comme en base).
function addTransfer(storage: MemoryStorage, ...keys: string[]): FakeTransfer {
  const transfer = { _id: new Types.ObjectId(), files: keys.map((storageKey) => ({ storageKey })) };
  for (const key of keys) storage.objects.set(key, Buffer.from(key));
  collection.push(transfer);
  return transfer;
}

// Stockage qui refuse de supprimer certaines clés, et note le moment de chaque suppression.
function withFailingKeys(storage: MemoryStorage, ...failing: string[]): Storage {
  const deleteObjects = storage.deleteObjects;
  storage.deleteObjects = async (keys) => {
    events.push("objets supprimés");
    const result = await deleteObjects(keys.filter((key) => !failing.includes(key)));
    return {
      ...result,
      failed: keys.filter((key) => failing.includes(key)).map((key) => ({ key, reason: "refus" })),
    };
  };
  return storage;
}

let logged: unknown[][] = [];
const originalConsoleError = console.error;
beforeEach(() => {
  collection = [];
  events = [];
  findFilters = [];
  deleteFilters = [];
  installFakeCollection();
  logged = [];
  console.error = (...args: unknown[]) => logged.push(args);
});
afterEach(() => {
  Object.assign(Transfer, originals);
  console.error = originalConsoleError;
});

describe("cleanupExpiredTransfers", () => {
  it("supprime les objets PUIS les documents, et renvoie le bilan", async () => {
    const storage = createMemoryStorage();
    addTransfer(storage, "uploads/1", "uploads/2");
    addTransfer(storage, "uploads/3");

    const report = await cleanupExpiredTransfers(withFailingKeys(storage));

    expect(report).toEqual({ transfers: 2, objects: 3, objectErrors: 0 });
    expect(events).toEqual(["objets supprimés", "documents supprimés"]);
    expect(storage.objects.size).toBe(0);
    expect(collection).toHaveLength(0);
  });

  it("conserve un transfert dont un objet n'a pas pu être supprimé, et traite les autres", async () => {
    const storage = createMemoryStorage();
    const kept = addTransfer(storage, "uploads/ok", "uploads/refuse");
    addTransfer(storage, "uploads/autre");

    const report = await cleanupExpiredTransfers(withFailingKeys(storage, "uploads/refuse"));

    expect(report).toEqual({ transfers: 1, objects: 2, objectErrors: 1 });
    // Le document reste, avec ses storageKey : c'est la seule piste pour réessayer.
    expect(collection).toEqual([kept]);
    expect(String(logged[0]?.[0])).toContain("conservés pour réessayer");
  });

  it("parcourt tous les lots sans reboucler sur les transferts conservés", async () => {
    const storage = createMemoryStorage();
    for (let i = 1; i <= 5; i++) addTransfer(storage, `uploads/${i}`);

    const report = await cleanupExpiredTransfers(withFailingKeys(storage, "uploads/1", "uploads/4"), {
      batchSize: 2,
    });

    expect(report).toEqual({ transfers: 3, objects: 3, objectErrors: 2 });
    // 3 lots (2 + 2 + 1) puis une page vide : chaque transfert n'est lu qu'une fois.
    expect(findFilters).toHaveLength(4);
    expect(collection.map((t) => t.files[0]?.storageKey)).toEqual(["uploads/1", "uploads/4"]);
  });

  it("ne vise que les transferts expirés depuis plus que le délai de grâce", async () => {
    const now = new Date("2026-11-24T12:00:00Z");

    await cleanupExpiredTransfers(createMemoryStorage(), { now, graceMs: 60 * 60 * 1000 });

    expect(findFilters[0]?.expiresAt.$lte).toEqual(new Date("2026-11-24T11:00:00Z"));
  });

  it("répète la condition d'expiration au moment de supprimer les documents", async () => {
    const storage = createMemoryStorage();
    addTransfer(storage, "uploads/1");

    await cleanupExpiredTransfers(storage);

    expect(deleteFilters[0]).toMatchObject({ expiresAt: { $lte: expect.any(Date) } });
  });

  it("ne fait rien s'il n'y a aucun transfert expiré", async () => {
    const storage = createMemoryStorage();
    storage.objects.set("uploads/actif", Buffer.from("x"));

    const report = await cleanupExpiredTransfers(storage);

    expect(report).toEqual({ transfers: 0, objects: 0, objectErrors: 0 });
    expect(storage.deletedKeys).toHaveLength(0);
  });
});
