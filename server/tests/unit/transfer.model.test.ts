// Teste le schéma Transfer sans base de données : validate() applique les règles Mongoose en mémoire.
import mongoose from "mongoose";
import { Transfer } from "../../src/models/transfer.model.js";

const file = { originalName: "photo.png", sizeBytes: 1024, storageKey: "uploads/abc.png" };
const inOneWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

// Renvoie les erreurs de validation par chemin ({} si valide). validateSync() est dépréciée depuis Mongoose 9.
async function validationErrors(data: Record<string, unknown>): Promise<Record<string, { message: string }>> {
  try {
    await new Transfer(data).validate();
    return {};
  } catch (error) {
    if (error instanceof mongoose.Error.ValidationError) return error.errors;
    throw error;
  }
}

describe("modèle Transfer", () => {
  it("accepte un transfert valide et applique les valeurs par défaut", async () => {
    const data = { code: "ABCD2345", expiresAt: inOneWeek, files: [file] };
    const transfer = new Transfer(data);

    expect(await validationErrors(data)).toEqual({});
    expect(transfer.maxDownloads).toBe(1);
    expect(transfer.downloadCount).toBe(0);
  });

  it("met le code en majuscules et retire les espaces", () => {
    const transfer = new Transfer({ code: "  abcd2345 ", expiresAt: inOneWeek, files: [file] });

    expect(transfer.code).toBe("ABCD2345");
  });

  it("exige code et expiresAt", async () => {
    const errors = await validationErrors({ files: [file] });

    expect(Object.keys(errors)).toEqual(expect.arrayContaining(["code", "expiresAt"]));
  });

  it("refuse un transfert sans fichier", async () => {
    const errors = await validationErrors({ code: "ABCD2345", expiresAt: inOneWeek, files: [] });

    expect(errors.files?.message).toBe("un transfert contient au moins un fichier");
  });

  it("exige les champs obligatoires de chaque fichier", async () => {
    const errors = await validationErrors({
      code: "ABCD2345",
      expiresAt: inOneWeek,
      files: [{ originalName: "a.txt" }],
    });

    expect(Object.keys(errors)).toEqual(expect.arrayContaining(["files.0.sizeBytes", "files.0.storageKey"]));
  });

  it("n'ajoute pas d'_id aux fichiers embarqués", () => {
    const transfer = new Transfer({ code: "ABCD2345", expiresAt: inOneWeek, files: [file] });

    expect(transfer.toObject().files[0]).not.toHaveProperty("_id");
  });

  // Vérifie la déclaration des index ; leur création réelle dans Mongo est vérifiée au démarrage (Transfer.init()).
  it("déclare un index unique sur code et un index simple (non TTL) sur expiresAt", () => {
    const indexes = Transfer.schema.indexes();

    expect(indexes).toContainEqual([{ code: 1 }, expect.objectContaining({ unique: true })]);
    const expiresIndex = indexes.find(([fields]) => "expiresAt" in fields);
    expect(expiresIndex).toBeDefined();
    expect(expiresIndex?.[1]).not.toHaveProperty("expireAfterSeconds");
  });
});
