// Réception multipart des fichiers d'un transfert : Multer + moteur S3, et traduction de ses erreurs en 400 / 413.
import type { RequestHandler } from "express";
import multer, { MulterError } from "multer";
import {
  formatMegabytes,
  MAX_FILE_SIZE_BYTES,
  MAX_FILES_PER_TRANSFER,
  MAX_TRANSFER_SIZE_BYTES,
} from "../configs/limits.js";
import { createS3StorageEngine, StorageWriteError, TotalSizeLimitError } from "../libs/s3-storage-engine.js";
import type { Storage } from "../libs/storage.js";
import { badRequest, type HttpError, payloadTooLarge } from "./http-error.js";

// Nom du champ multipart attendu (contrat d'API, section 5.3 du plan).
export const FILES_FIELD = "files";

export type UploadLimits = {
  maxFileSizeBytes: number;
  maxFiles: number;
  maxTotalBytes: number;
};

const DEFAULT_LIMITS: UploadLimits = {
  maxFileSizeBytes: MAX_FILE_SIZE_BYTES,
  maxFiles: MAX_FILES_PER_TRANSFER,
  maxTotalBytes: MAX_TRANSFER_SIZE_BYTES,
};

// Une erreur 400/413 pour tout ce qui vient du client ; seule une panne du stockage reste une erreur 500.
// Le reste (formulaire tronqué, frontière multipart absente, client parti en cours d'envoi) provient de busboy
// sous forme d'Error ordinaire : c'est une requête invalide, pas un bug du serveur.
export function toHttpError(error: unknown, limits: UploadLimits): HttpError | StorageWriteError {
  if (error instanceof StorageWriteError) return error;
  if (error instanceof TotalSizeLimitError) {
    return payloadTooLarge(
      `L'envoi dépasse la taille totale maximale de ${formatMegabytes(limits.maxTotalBytes)}.`,
    );
  }
  if (error instanceof MulterError) {
    // Multer 2 renseigne `filename` sur les erreurs liées à un fichier, mais @types/multer ne le déclare pas encore.
    const { filename } = error as MulterError & { filename?: string };
    switch (error.code) {
      case "LIMIT_FILE_SIZE":
        return payloadTooLarge(
          `Le fichier « ${filename ?? "?"} » dépasse la taille maximale de ${formatMegabytes(limits.maxFileSizeBytes)}.`,
        );
      case "LIMIT_FILE_COUNT":
        return badRequest(`Trop de fichiers : ${limits.maxFiles} au maximum par transfert.`);
      case "LIMIT_UNEXPECTED_FILE":
        return badRequest(`Les fichiers doivent être envoyés dans le champ « ${FILES_FIELD} ».`);
      case "LIMIT_FIELD_COUNT":
        return badRequest("Seuls des fichiers sont acceptés dans cet envoi.");
    }
  }
  return badRequest("Le formulaire d'envoi est invalide ou incomplet.");
}

// `limits` est injectable pour que les tests vérifient les dépassements avec quelques octets, pas 200 Mo.
export function createUploadMiddleware(
  storage: Storage,
  limits: UploadLimits = DEFAULT_LIMITS,
): RequestHandler {
  const upload = multer({
    storage: createS3StorageEngine(storage, { maxTotalBytes: limits.maxTotalBytes }),
    limits: {
      fileSize: limits.maxFileSizeBytes,
      files: limits.maxFiles,
      // Aucun champ texte attendu : en refuser n'importe lequel ferme la porte aux corps de requête détournés.
      fields: 0,
    },
    // Par défaut busboy décode les noms de fichiers en latin1 : « été.txt » deviendrait « Ã©tÃ©.txt ».
    // Navigateurs et curl envoient de l'UTF-8.
    defParamCharset: "utf8",
  }).array(FILES_FIELD, limits.maxFiles);

  return (req, res, next) => {
    upload(req, res, (error?: unknown) => {
      next(error === undefined ? undefined : toHttpError(error, limits));
    });
  };
}
