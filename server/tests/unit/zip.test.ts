// Teste la construction du ZIP : noms d'entrées sûrs et uniques, ouverture séquentielle, erreurs et arrêt.
import { PassThrough, Readable } from "node:stream";
import { createZipStream, dedupeEntryNames, sanitizeEntryName } from "../../src/libs/zip.js";

// Laisse s'exécuter les promesses et callbacks en attente.
const tick = () => new Promise((resolve) => setImmediate(resolve));

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

describe("sanitizeEntryName", () => {
  it.each([
    ["../../etc/passwd", ".._.._etc_passwd"],
    ["dossier\\fichier.txt", "dossier_fichier.txt"],
    ["  espaces.txt  ", "espaces.txt"],
    ["re\r\ntour.txt", "retour.txt"],
    ["..", "fichier"],
    ["\u0000", "fichier"],
  ])("%j → %j", (input, expected) => {
    expect(sanitizeEntryName(input)).toBe(expected);
  });
});

describe("dedupeEntryNames", () => {
  it("numérote les doublons avant l'extension, sans tenir compte de la casse", () => {
    expect(dedupeEntryNames(["a.txt", "a.txt", "A.TXT", "a (2).txt"])).toEqual([
      "a.txt",
      "a (2).txt",
      "A (3).TXT",
      "a (2) (2).txt",
    ]);
  });

  it("gère les noms sans extension et les fichiers cachés", () => {
    expect(dedupeEntryNames(["notes", "notes", ".env", ".env"])).toEqual([
      "notes",
      "notes (2)",
      ".env",
      ".env (2)",
    ]);
  });

  it("laisse intacts des noms déjà uniques", () => {
    expect(dedupeEntryNames(["a.txt", "b.txt", "Été.txt"])).toEqual(["a.txt", "b.txt", "Été.txt"]);
  });
});

describe("createZipStream", () => {
  it("produit une archive ZIP contenant une entrée par fichier", async () => {
    const zip = createZipStream([
      { name: "a.txt", open: async () => Readable.from([Buffer.from("A")]) },
      { name: "a.txt", open: async () => Readable.from([Buffer.from("B")]) },
    ]);

    const archive = await collect(zip);

    // En-tête local (PK\3\4) au début, fin du répertoire central (PK\5\6) : c'est bien un ZIP complet.
    expect(archive.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    expect(archive.includes(Buffer.from([0x50, 0x4b, 0x05, 0x06]))).toBe(true);
    expect(archive.includes("a.txt")).toBe(true);
    expect(archive.includes("a (2).txt")).toBe(true);
  });

  it("n'ouvre un fichier qu'une fois le précédent entièrement lu", async () => {
    const first = new PassThrough();
    const opened: string[] = [];
    const zip = createZipStream([
      { name: "1.txt", open: async () => (opened.push("1"), first) },
      { name: "2.txt", open: async () => (opened.push("2"), Readable.from([Buffer.from("deux")])) },
    ]);
    const done = collect(zip);

    first.write("début");
    await tick();
    expect(opened).toEqual(["1"]);

    first.end("fin");
    await done;
    expect(opened).toEqual(["1", "2"]);
  });

  it("détruit l'archive avec l'erreur si un fichier ne peut pas être ouvert", async () => {
    const zip = createZipStream([
      {
        name: "a.txt",
        open: async () => {
          throw new Error("NoSuchKey");
        },
      },
    ]);

    await expect(collect(zip)).rejects.toThrow("NoSuchKey");
  });

  // Client parti : le flux S3 en cours doit être fermé (sinon la connexion S3 reste ouverte), et la suite abandonnée.
  it("ferme le fichier en cours et n'ouvre pas les suivants si l'archive est détruite", async () => {
    const first = new PassThrough();
    let secondOpened = false;
    const zip = createZipStream([
      { name: "1.txt", open: async () => first },
      {
        name: "2.txt",
        open: async () => {
          secondOpened = true;
          return Readable.from([]);
        },
      },
    ]);
    zip.resume();
    first.write("début");
    await tick();

    zip.destroy();
    await tick();

    expect(first.destroyed).toBe(true);
    expect(secondOpened).toBe(false);
  });
});
