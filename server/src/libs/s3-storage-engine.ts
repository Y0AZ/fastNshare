// Moteur de stockage Multer : chaque fichier reçu part vers S3 au fil de l'eau, sans passer par la mémoire ni le disque.
import { Transform } from "node:stream";
import type { Request } from "express";
import type { StorageEngine } from "multer";
import { buildStorageKey, type Storage } from "./storage.js";

// Le cumul des fichiers d'une même requête dépasse le plafond. Traduite en 413 par le middleware d'upload.
export class TotalSizeLimitError extends Error {
  constructor(readonly limitBytes: number) {
    super(`taille totale de l'envoi supérieure à ${limitBytes} octets`);
    this.name = "TotalSizeLimitError";
  }
}

// Échec du stockage lui-même (S3 injoignable, droits…) : une panne, pas une faute du client, donc une réponse 500.
export class StorageWriteError extends Error {
  constructor(cause: unknown) {
    super("échec de l'écriture d'un fichier dans le stockage", { cause });
    this.name = "StorageWriteError";
  }
}

type InFlightUpload = {
  cancel: () => void;
  // Résolue quand l'envoi est réellement terminé (succès ou échec), jamais rejetée.
  settled: Promise<void>;
};

export function createS3StorageEngine(
  storage: Storage,
  { maxTotalBytes }: { maxTotalBytes: number },
): StorageEngine {
  // Octets déjà reçus par requête, tous fichiers confondus. WeakMap : l'entrée disparaît avec la requête.
  const receivedBytes = new WeakMap<Request, number>();
  const inFlight = new Map<string, InFlightUpload>();

  return {
    _handleFile(req, file, callback) {
      const key = buildStorageKey(file.originalname);
      // Renseigné AVANT tout envoi : en cas d'abandon, Multer n'appelle _removeFile que sur les fichiers qui ont
      // déjà un `path`. Sans lui, un fichier en cours d'envoi serait oublié et resterait orphelin dans le bucket.
      file.path = key;

      let size = 0;
      let limitError: TotalSizeLimitError | undefined;
      // Compteur d'octets placé entre la requête et S3 : il coupe l'envoi dès que le CUMUL dépasse le plafond,
      // ce que Multer ne sait pas faire (sa limite `fileSize` est par fichier).
      const counter = new Transform({
        transform(chunk: Buffer, _encoding, next) {
          size += chunk.length;
          const total = (receivedBytes.get(req) ?? 0) + chunk.length;
          receivedBytes.set(req, total);
          if (total > maxTotalBytes) {
            limitError = new TotalSizeLimitError(maxTotalBytes);
            next(limitError);
            return;
          }
          next(null, chunk);
        },
      });

      // Détruire le flux source fait échouer l'envoi proprement (voir putStream), sans risque d'objet tardif.
      const cancel = () => counter.destroy(new Error("envoi annulé"));
      // Fichier trop gros : busboy se contente de TRONQUER le flux. Sans cette annulation, on enverrait vers S3
      // les 200 premiers Mo d'un fichier qui sera de toute façon refusé.
      file.stream.once("limit", cancel);
      // pipe() ne propage pas les erreurs de la source : on les relaie pour ne pas laisser l'envoi en attente.
      file.stream.once("error", cancel);
      // Backpressure : pipe() met la requête en pause quand S3 n'absorbe plus assez vite, la mémoire reste bornée.
      file.stream.pipe(counter);

      const settled = storage.putStream(key, counter, { contentType: file.mimetype }).then(
        () => callback(null, { path: key, size }),
        (error: unknown) => {
          // Le reste du fichier est lu et jeté : sinon busboy resterait bloqué sur ce flux non consommé.
          file.stream.unpipe(counter);
          file.stream.resume();
          callback(limitError ?? new StorageWriteError(error));
        },
      );
      inFlight.set(key, { cancel, settled: settled.finally(() => inFlight.delete(key)) });
    },

    // Appelé par Multer quand la requête échoue (limite dépassée, client parti…) pour chaque fichier déjà écrit
    // ou en cours d'écriture. Un envoi en cours est d'abord annulé et ATTENDU : il peut aboutir malgré l'annulation
    // (PUT déjà parti), et supprimer avant qu'il se termine laisserait l'objet réapparaître juste après.
    _removeFile(_req, file, callback) {
      const upload = inFlight.get(file.path);
      upload?.cancel();
      void (upload?.settled ?? Promise.resolve())
        .then(() => storage.deleteObjects([file.path]))
        .then(({ failed }) => {
          callback(failed.length > 0 ? new Error(`suppression impossible : ${failed[0]?.reason}`) : null);
        });
    },
  };
}
