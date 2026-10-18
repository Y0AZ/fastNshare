// Contrôleur des transferts : traduit les requêtes HTTP en opérations sur le modèle Transfer et le stockage.
import { pipeline } from "node:stream/promises";
import type { RequestHandler } from "express";
import { MAX_DOWNLOADS, TRANSFER_TTL_MS } from "../configs/limits.js";
import { generateUniqueCode, isValidCode, normalizeCode } from "../libs/code.js";
import type { Storage } from "../libs/storage.js";
import { createZipStream } from "../libs/zip.js";
import { badRequest, gone, HttpError, notFound } from "../middlewares/http-error.js";
import { Transfer } from "../models/transfer.model.js";

const UNKNOWN_CODE = "Code inconnu : vérifiez le code saisi.";

// Après un échec de réservation : relit le transfert pour dire POURQUOI il n'est pas disponible.
async function unavailableError(code: string): Promise<HttpError> {
  const transfer = await Transfer.findOne({ code }, { expiresAt: 1, downloadCount: 1, maxDownloads: 1 });
  if (!transfer) return notFound(UNKNOWN_CODE);
  if (transfer.expiresAt.getTime() <= Date.now()) return gone("Ce transfert a expiré.");
  return gone("Ce transfert a déjà été téléchargé.");
}

export function createTransfersController(storage: Storage) {
  // Appelé une fois les fichiers déjà dans S3 (middleware d'upload) : il ne reste qu'à enregistrer le transfert.
  const create: RequestHandler = async (req, res) => {
    const uploaded = req.files;
    // Requête non multipart, ou multipart sans fichier : Multer laisse alors req.files vide ou absent.
    if (!Array.isArray(uploaded) || uploaded.length === 0) {
      throw badRequest("Aucun fichier reçu : ajoutez au moins un fichier.");
    }

    const files = uploaded.map((file) => ({
      originalName: file.originalname,
      sizeBytes: file.size,
      storageKey: file.path,
      contentType: file.mimetype,
    }));

    let transfer;
    try {
      transfer = await generateUniqueCode((code) =>
        Transfer.create({
          code,
          expiresAt: new Date(Date.now() + TRANSFER_TTL_MS),
          maxDownloads: MAX_DOWNLOADS,
          files,
        }),
      );
    } catch (error) {
      // Compensation : sans transaction entre S3 et Mongo, des fichiers écrits sans document qui les référence
      // seraient invisibles pour le nettoyage (T2.5), donc conservés et facturés pour toujours. On les supprime.
      const { failed } = await storage.deleteObjects(files.map((file) => file.storageKey));
      if (failed.length > 0) {
        // Dernier recours : seules ces lignes de log permettent encore de retrouver les objets à supprimer.
        console.error("Compensation incomplète, objets orphelins dans le bucket :", failed);
      }
      throw error;
    }

    res.status(201).json({ code: transfer.code, expiresAt: transfer.expiresAt });
  };

  const download: RequestHandler = async (req, res) => {
    const code = normalizeCode(String(req.params.code));
    if (!isValidCode(code)) throw notFound(UNKNOWN_CODE);

    // Réservation atomique AVANT d'envoyer quoi que ce soit : la condition et l'incrément forment une seule
    // opération évaluée par Mongo. Deux requêtes simultanées ne peuvent donc pas passer toutes les deux ;
    // « lire puis incrémenter » en deux temps laisserait les deux lire downloadCount = 0 et télécharger.
    const transfer = await Transfer.findOneAndUpdate(
      { code, expiresAt: { $gt: new Date() }, $expr: { $lt: ["$downloadCount", "$maxDownloads"] } },
      { $inc: { downloadCount: 1 } },
      { returnDocument: "after" },
    );
    if (!transfer) throw await unavailableError(code);

    // Rend le téléchargement si l'envoi échoue, pour que le destinataire puisse réessayer.
    // `downloadCount > 0` : garde-fou pour ne jamais passer sous zéro, même si la libération était rejouée.
    let reserved = true;
    const release = async () => {
      if (!reserved) return;
      reserved = false;
      try {
        await Transfer.updateOne(
          { _id: transfer._id, downloadCount: { $gt: 0 } },
          { $inc: { downloadCount: -1 } },
        );
      } catch (error) {
        console.error(`Impossible de libérer la réservation du transfert ${code} :`, error);
      }
    };

    // Vérifie que tous les objets existent tant qu'une réponse JSON est encore possible. Sinon le destinataire
    // recevrait un ZIP coupé au milieu au lieu d'un message clair. Cas réel : le document « fantôme » créé
    // quand Mongo tombe pendant un upload compensé (voir T2.2), dont les objets ont été supprimés.
    let present: boolean[];
    try {
      present = await Promise.all(transfer.files.map((file) => storage.exists(file.storageKey)));
    } catch (error) {
      await release();
      throw error;
    }
    const missing = transfer.files.filter((_file, index) => !present[index]);
    if (missing.length > 0) {
      // Pas de libération : les fichiers sont perdus, réessayer ne servirait à rien.
      console.error(
        `Transfert ${code} incomplet, objets absents du bucket :`,
        missing.map((f) => f.storageKey),
      );
      throw gone("Ce transfert n'est plus disponible : ses fichiers sont introuvables.");
    }

    res.set({
      "Content-Type": "application/zip",
      // Le code ne contient que des lettres et chiffres validés : il peut figurer tel quel dans l'en-tête.
      "Content-Disposition": `attachment; filename="fastshare-${code}.zip"`,
      // Un téléchargement unique ne doit être gardé par aucun cache (navigateur, proxy) : il serait rejouable.
      "Cache-Control": "no-store",
    });

    const zip = createZipStream(
      transfer.files.map((file) => ({
        name: file.originalName,
        open: () => storage.getStream(file.storageKey),
      })),
    );
    try {
      // pipeline relie l'archive à la réponse et détruit l'une si l'autre échoue : client parti → archive (et
      // flux S3 en cours) détruits ; erreur de l'archive → réponse détruite, donc connexion coupée.
      await pipeline(zip, res);
    } catch (error) {
      // En-têtes déjà partis : aucun JSON possible, la coupure de connexion est le seul signal pour le client.
      await release();
      const clientLeft = (error as { code?: unknown }).code === "ERR_STREAM_PREMATURE_CLOSE";
      if (!clientLeft) console.error(`Échec de l'envoi du ZIP du transfert ${code} :`, error);
    }
  };

  return { create, download };
}
