// Teste la réception multipart (Multer + moteur S3) avec un stockage en mémoire et des limites de quelques octets.
import { Readable } from "node:stream";
import express, { type Request } from "express";
import { MulterError } from "multer";
import request from "supertest";
import {
  createS3StorageEngine,
  StorageWriteError,
  TotalSizeLimitError,
} from "../../src/libs/s3-storage-engine.js";
import { errorHandler } from "../../src/middlewares/error-handler.js";
import { HttpError } from "../../src/middlewares/http-error.js";
import { createUploadMiddleware, toHttpError, type UploadLimits } from "../../src/middlewares/upload.js";
import { createMemoryStorage, type MemoryStorage } from "../helpers/memory-storage.js";

const LIMITS: UploadLimits = { maxFileSizeBytes: 10, maxFiles: 3, maxTotalBytes: 15 };

// Mini-app : le middleware d'upload devant une route qui renvoie ce que Multer a reçu.
function buildTestApp(storage: MemoryStorage) {
  const app = express();
  app.post("/upload", createUploadMiddleware(storage, LIMITS), (req, res) => {
    const files = Array.isArray(req.files) ? req.files : [];
    res.json(files.map(({ originalname, size, path, mimetype }) => ({ originalname, size, path, mimetype })));
  });
  app.use(errorHandler);
  return app;
}

// Le gestionnaire d'erreurs journalise les 500 : on capture la sortie pour garder les tests lisibles.
const originalConsoleError = console.error;
beforeEach(() => {
  console.error = () => {};
});
afterEach(() => {
  console.error = originalConsoleError;
});

describe("createUploadMiddleware", () => {
  it("envoie chaque fichier vers le stockage sous une clé opaque, avec sa taille", async () => {
    const storage = createMemoryStorage();

    const response = await request(buildTestApp(storage))
      .post("/upload")
      .attach("files", Buffer.from("hello"), "a.txt")
      .attach("files", Buffer.from("world!"), "photo.PNG");

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(2);
    const [first, second] = response.body as { originalname: string; size: number; path: string }[];
    expect(first).toMatchObject({ originalname: "a.txt", size: 5 });
    expect(first?.path).toMatch(/^uploads\/[0-9a-f-]{36}\.txt$/);
    expect(second).toMatchObject({ originalname: "photo.PNG", size: 6 });
    expect(storage.objects.get(first?.path ?? "")?.toString()).toBe("hello");
    expect(storage.objects.get(second?.path ?? "")?.toString()).toBe("world!");
  });

  it("conserve les noms de fichiers accentués (UTF-8)", async () => {
    const response = await request(buildTestApp(createMemoryStorage()))
      .post("/upload")
      .attach("files", Buffer.from("x"), "été à Noël.txt");

    expect(response.body[0].originalname).toBe("été à Noël.txt");
  });

  it("refuse un fichier trop gros (413) et ne laisse aucun objet", async () => {
    const storage = createMemoryStorage();

    const response = await request(buildTestApp(storage))
      .post("/upload")
      .attach("files", Buffer.from("123"), "petit.txt")
      .attach("files", Buffer.alloc(11), "gros.bin");

    expect(response.status).toBe(413);
    expect(response.body.error).toContain("« gros.bin »");
    expect(storage.objects.size).toBe(0);
  });

  // Chaque fichier respecte la limite unitaire (8 ≤ 10), mais le cumul (16) dépasse le plafond (15).
  it("refuse un envoi dont le total est trop gros (413) et supprime les fichiers déjà écrits", async () => {
    const storage = createMemoryStorage();

    const response = await request(buildTestApp(storage))
      .post("/upload")
      .attach("files", Buffer.alloc(8), "un.bin")
      .attach("files", Buffer.alloc(8), "deux.bin");

    expect(response.status).toBe(413);
    expect(response.body.error).toMatch(/taille totale/);
    expect(storage.objects.size).toBe(0);
    // Le premier fichier avait bien été écrit : il a été supprimé, pas seulement « jamais envoyé ».
    expect(storage.deletedKeys).toHaveLength(1);
  });

  it("refuse plus de fichiers que la limite (400) sans rien laisser", async () => {
    const storage = createMemoryStorage();
    let req = request(buildTestApp(storage)).post("/upload");
    for (let i = 1; i <= 4; i++) req = req.attach("files", Buffer.from("x"), `f${i}.txt`);

    const response = await req;

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Trop de fichiers : 3 au maximum par transfert.");
    expect(storage.objects.size).toBe(0);
  });

  it("refuse un fichier envoyé dans un autre champ que « files » (400)", async () => {
    const response = await request(buildTestApp(createMemoryStorage()))
      .post("/upload")
      .attach("document", Buffer.from("x"), "a.txt");

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("« files »");
  });

  it("refuse les champs texte (400)", async () => {
    const response = await request(buildTestApp(createMemoryStorage()))
      .post("/upload")
      .field("note", "bonjour")
      .attach("files", Buffer.from("x"), "a.txt");

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Seuls des fichiers sont acceptés dans cet envoi.");
  });

  it("répond 400 à un corps multipart mal formé", async () => {
    const response = await request(buildTestApp(createMemoryStorage()))
      .post("/upload")
      .set("Content-Type", "multipart/form-data; boundary=frontiere")
      .send('--frontiere\r\nContent-Disposition: form-data; name="files"; filename="a.txt"\r\n\r\ntronqué');

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Le formulaire d'envoi est invalide ou incomplet.");
  });

  it("répond 500 si le stockage échoue : c'est une panne, pas une faute du client", async () => {
    const response = await request(buildTestApp(createMemoryStorage({ failPut: true })))
      .post("/upload")
      .attach("files", Buffer.from("x"), "a.txt");

    expect(response.status).toBe(500);
  });
});

describe("createS3StorageEngine._removeFile", () => {
  // Rejoue la course réelle : le client part pendant que l'écriture est en vol, et celle-ci aboutit quand même
  // (PUT déjà parti). Supprimer sans attendre laisserait l'objet réapparaître juste après.
  it("attend la fin d'une écriture en cours avant de supprimer l'objet", async () => {
    let release: (() => void) | undefined;
    const storage = createMemoryStorage({ holdPut: (resolve) => (release = resolve) });
    const engine = createS3StorageEngine(storage, { maxTotalBytes: 100 });
    const req = {} as Request;
    const file = {
      originalname: "a.txt",
      mimetype: "text/plain",
      stream: Readable.from([Buffer.from("abc")]),
    } as Express.Multer.File;

    engine._handleFile(req, file, () => {});
    while (release === undefined) await new Promise((resolve) => setImmediate(resolve));

    let removed = false;
    const removal = new Promise<void>((resolve) =>
      engine._removeFile(req, file, () => {
        removed = true;
        resolve();
      }),
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(removed).toBe(false);

    release();
    await removal;

    expect(storage.objects.size).toBe(0);
    expect(storage.deletedKeys).toEqual([file.path]);
  });
});

describe("toHttpError", () => {
  // Limites réelles : les messages affichés à l'utilisateur doivent citer les vraies valeurs.
  const REAL: UploadLimits = {
    maxFileSizeBytes: 200 * 1024 * 1024,
    maxFiles: 20,
    maxTotalBytes: 500 * 1024 * 1024,
  };
  const multerError = (code: ConstructorParameters<typeof MulterError>[0], filename?: string) =>
    Object.assign(new MulterError(code, "files"), filename ? { filename } : {});

  it.each([
    [
      "LIMIT_FILE_SIZE",
      multerError("LIMIT_FILE_SIZE", "film.mp4"),
      413,
      "Le fichier « film.mp4 » dépasse la taille maximale de 200 Mo.",
    ],
    [
      "LIMIT_FILE_COUNT",
      multerError("LIMIT_FILE_COUNT"),
      400,
      "Trop de fichiers : 20 au maximum par transfert.",
    ],
    [
      "LIMIT_UNEXPECTED_FILE",
      multerError("LIMIT_UNEXPECTED_FILE"),
      400,
      "Les fichiers doivent être envoyés dans le champ « files ».",
    ],
    [
      "LIMIT_FIELD_COUNT",
      multerError("LIMIT_FIELD_COUNT"),
      400,
      "Seuls des fichiers sont acceptés dans cet envoi.",
    ],
    [
      "un autre code Multer",
      multerError("LIMIT_PART_COUNT"),
      400,
      "Le formulaire d'envoi est invalide ou incomplet.",
    ],
    [
      "le plafond du cumul",
      new TotalSizeLimitError(500 * 1024 * 1024),
      413,
      "L'envoi dépasse la taille totale maximale de 500 Mo.",
    ],
    [
      "une erreur de busboy",
      new Error("Unexpected end of form"),
      400,
      "Le formulaire d'envoi est invalide ou incomplet.",
    ],
  ])("traduit %s en HttpError %i", (_label, error, status, message) => {
    const translated = toHttpError(error, REAL);

    expect(translated).toBeInstanceOf(HttpError);
    expect(translated).toMatchObject({ status, message });
  });

  it("laisse passer une panne de stockage telle quelle (réponse 500)", () => {
    const failure = new StorageWriteError(new Error("S3 injoignable"));

    expect(toHttpError(failure, REAL)).toBe(failure);
  });
});

describe("createS3StorageEngine._removeFile (échec)", () => {
  it("signale à Multer une suppression que le stockage a refusée", async () => {
    const storage = createMemoryStorage();
    storage.deleteObjects = async (keys) => ({
      deleted: 0,
      failed: keys.map((key) => ({ key, reason: "AccessDenied" })),
    });
    const engine = createS3StorageEngine(storage, { maxTotalBytes: 100 });
    const file = { path: "uploads/inconnu.txt" } as Express.Multer.File;

    const error = await new Promise<Error | null>((resolve) =>
      engine._removeFile({} as Request, file, resolve),
    );

    expect(error?.message).toBe("suppression impossible : AccessDenied");
  });
});
