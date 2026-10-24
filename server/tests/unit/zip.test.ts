// Teste la construction du ZIP : noms sûrs et uniques, taille exacte annoncée, ouverture séquentielle, erreurs, arrêt.
import { PassThrough, Readable } from "node:stream";
import {
  computeZipSize,
  createZipStream,
  dedupeEntryNames,
  sanitizeEntryName,
  type ZipEntrySource,
} from "../../src/libs/zip.js";
import { readStoredZip } from "../helpers/read-zip.js";

// Laisse s'exécuter les promesses et callbacks en attente.
const tick = () => new Promise((resolve) => setImmediate(resolve));

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

// Entrée dont le contenu est connu d'avance : taille exacte, ouverture comptée.
function entry(name: string, content: Buffer | string): ZipEntrySource {
  const buffer = Buffer.from(content);
  return { name, sizeBytes: buffer.length, open: async () => Readable.from([buffer]) };
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

describe("computeZipSize", () => {
  // Au-delà de 4 Gio, archiver passe en Zip64 et la formule ne vaut plus : mieux vaut ne rien annoncer
  // (envoi sans Content-Length) qu'annoncer une taille fausse. Impossible avec les limites actuelles (500 Mo).
  it("renonce à annoncer une taille au-delà de 4 Gio", () => {
    expect(computeZipSize([{ name: "a.bin", sizeBytes: 0xffffffff }])).toBeUndefined();
    expect(
      computeZipSize([
        { name: "a.bin", sizeBytes: 3 * 1024 ** 3 },
        { name: "b.bin", sizeBytes: 2 * 1024 ** 3 },
      ]),
    ).toBeUndefined();
  });
});

describe("createZipStream", () => {
  it("produit une archive ZIP contenant une entrée par fichier", async () => {
    const { stream } = createZipStream([entry("a.txt", "A"), entry("a.txt", "B")]);

    const archive = await collect(stream);

    // En-tête local (PK\3\4) au début, fin du répertoire central (PK\5\6) : c'est bien un ZIP complet.
    expect(archive.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    expect(archive.includes(Buffer.from([0x50, 0x4b, 0x05, 0x06]))).toBe(true);
    expect(archive.includes("a.txt")).toBe(true);
    expect(archive.includes("a (2).txt")).toBe(true);
  });

  // Vérifie aussi le lecteur de ZIP des tests d'intégration : relue, l'archive redonne exactement les fichiers.
  it("produit une archive dont chaque fichier se relit à l'identique", async () => {
    const big = Buffer.from(Array.from({ length: 300_000 }, (_, i) => i % 251));
    const { stream } = createZipStream([
      entry("Été.txt", "accent"),
      entry("gros.bin", big),
      entry("Été.txt", ""),
    ]);

    const files = readStoredZip(await collect(stream));

    expect([...files.keys()]).toEqual(["Été.txt", "gros.bin", "Été (2).txt"]);
    expect(files.get("Été.txt")?.toString()).toBe("accent");
    expect(files.get("gros.bin")?.equals(big)).toBe(true);
    expect(files.get("Été (2).txt")?.length).toBe(0);
  });

  // Le Content-Length repose sur ce calcul : il doit être exact à l'octet près, sinon le téléchargement casse.
  it.each([
    ["un petit fichier", [entry("a.txt", "bonjour")]],
    ["un fichier vide", [entry("vide.txt", "")]],
    [
      "des noms accentués (octets UTF-8 ≠ caractères)",
      [entry("Été à Noël.txt", "x"), entry("日本.txt", "y")],
    ],
    ["des doublons renommés", [entry("a.txt", "1"), entry("A.TXT", "2"), entry("a.txt", "3")]],
    ["un nom à nettoyer", [entry("../../etc/passwd", "z")]],
    ["1 Mo de données", [entry("gros.bin", Buffer.alloc(1024 * 1024, 7)), entry("b.txt", "b")]],
    ["20 fichiers", Array.from({ length: 20 }, (_, i) => entry(`f${i}.txt`, "x".repeat(i * 100)))],
  ])("annonce la taille exacte de l'archive : %s", async (_label, entries) => {
    const { stream, sizeBytes } = createZipStream(entries);

    const archive = await collect(stream);

    expect(sizeBytes).toBe(archive.length);
  });

  it.each([
    ["plus court", 5],
    ["plus long", 3],
  ])("échoue si un fichier est %s que la taille annoncée", async (_label, announced) => {
    const { stream } = createZipStream([
      { name: "a.txt", sizeBytes: announced, open: async () => Readable.from([Buffer.from("1234")]) },
    ]);

    await expect(collect(stream)).rejects.toThrow(/taille inattendue/);
  });

  // Sans report explicite, archiver attendrait indéfiniment la fin de ce flux : téléchargement suspendu.
  it("échoue si un fichier S3 s'interrompt en cours de lecture", async () => {
    const source = new PassThrough();
    const { stream } = createZipStream([{ name: "a.txt", sizeBytes: 100, open: async () => source }]);
    const done = collect(stream);

    source.write("debut");
    await tick();
    source.destroy(new Error("connexion S3 perdue"));

    await expect(done).rejects.toThrow("connexion S3 perdue");
  });

  it("n'ouvre un fichier qu'une fois le précédent entièrement lu", async () => {
    const first = new PassThrough();
    const opened: string[] = [];
    const { stream } = createZipStream([
      { name: "1.txt", sizeBytes: 8, open: async () => (opened.push("1"), first) },
      {
        name: "2.txt",
        sizeBytes: 4,
        open: async () => (opened.push("2"), Readable.from([Buffer.from("deux")])),
      },
    ]);
    const done = collect(stream);

    first.write("debut");
    await tick();
    expect(opened).toEqual(["1"]);

    first.end("fin");
    await done;
    expect(opened).toEqual(["1", "2"]);
  });

  it("détruit l'archive avec l'erreur si un fichier ne peut pas être ouvert", async () => {
    const { stream } = createZipStream([
      {
        name: "a.txt",
        sizeBytes: 1,
        open: async () => {
          throw new Error("NoSuchKey");
        },
      },
    ]);

    await expect(collect(stream)).rejects.toThrow("NoSuchKey");
  });

  // Client parti : le flux S3 en cours doit être fermé (sinon la connexion S3 reste ouverte), et la suite abandonnée.
  it("ferme le fichier en cours et n'ouvre pas les suivants si l'archive est détruite", async () => {
    const first = new PassThrough();
    let secondOpened = false;
    const { stream } = createZipStream([
      { name: "1.txt", sizeBytes: 100, open: async () => first },
      {
        name: "2.txt",
        sizeBytes: 0,
        open: async () => {
          secondOpened = true;
          return Readable.from([]);
        },
      },
    ]);
    stream.resume();
    first.write("debut");
    await tick();

    stream.destroy();
    await tick();

    expect(first.destroyed).toBe(true);
    expect(secondOpened).toBe(false);
  });

  // Course réelle : le client part pendant que la requête GetObject est en vol. Le flux qui arrive ensuite
  // doit être fermé aussitôt, sinon la connexion S3 resterait ouverte pour rien.
  it("ferme un flux S3 arrivé après la destruction de l'archive", async () => {
    let deliver: (stream: Readable) => void = () => {};
    const late = new PassThrough();
    const { stream } = createZipStream([
      { name: "a.txt", sizeBytes: 1, open: () => new Promise<Readable>((resolve) => (deliver = resolve)) },
    ]);

    // L'archive est détruite ET son événement « close » déjà traité avant que le flux n'arrive : c'est bien
    // le flux retardataire qu'on teste, pas celui que le gestionnaire de « close » fermerait.
    stream.destroy();
    await tick();
    deliver(late);
    await tick();

    expect(late.destroyed).toBe(true);
  });
});
