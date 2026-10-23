// Nettoyage des transferts expirés : supprime réellement leurs fichiers du bucket, puis leurs documents.
// Indépendant d'Express : déclenché par la route de maintenance, il pourrait l'être par un script ou un cron.
import type { Types } from "mongoose";
import { CLEANUP_BATCH_SIZE, CLEANUP_GRACE_MS } from "../configs/limits.js";
import type { Storage } from "../libs/storage.js";
import { Transfer } from "../models/transfer.model.js";

export type CleanupReport = {
  // Documents supprimés de la base.
  transfers: number;
  // Objets supprimés du bucket.
  objects: number;
  // Objets que S3 n'a pas pu supprimer : leurs transferts sont conservés pour réessayer au prochain passage.
  objectErrors: number;
};

// Seuls champs lus : la projection évite de charger noms et tailles de fichiers inutiles ici.
type ExpiredTransfer = { _id: Types.ObjectId; files: { storageKey: string }[] };

type CleanupOptions = {
  now?: Date;
  graceMs?: number;
  batchSize?: number;
};

export async function cleanupExpiredTransfers(
  storage: Storage,
  { now = new Date(), graceMs = CLEANUP_GRACE_MS, batchSize = CLEANUP_BATCH_SIZE }: CleanupOptions = {},
): Promise<CleanupReport> {
  const report: CleanupReport = { transfers: 0, objects: 0, objectErrors: 0 };
  const cutoff = new Date(now.getTime() - graceMs);
  // Pagination par _id croissant : un transfert conservé (échec S3) n'est jamais relu dans ce passage,
  // ce qui évite de boucler indéfiniment sur lui.
  let lastId: Types.ObjectId | undefined;

  for (;;) {
    const batch = await Transfer.find<ExpiredTransfer>(
      { expiresAt: { $lte: cutoff }, ...(lastId && { _id: { $gt: lastId } }) },
      { "files.storageKey": 1 },
      { sort: { _id: 1 }, limit: batchSize, lean: true },
    );
    if (batch.length === 0) return report;
    lastId = batch[batch.length - 1]?._id;

    // Ordre imposé : les objets S3 D'ABORD, les documents ENSUITE. Un document sans objets (suppression en base
    // ratée) est réparable : le passage suivant le retrouve et S3 accepte de supprimer une clé déjà absente
    // (idempotence). Un objet sans document serait irréparable : plus rien ne mènerait à sa clé, il resterait
    // stocké et facturé pour toujours.
    const { deleted, failed } = await storage.deleteObjects(
      batch.flatMap((transfer) => transfer.files.map((file) => file.storageKey)),
    );
    report.objects += deleted;
    report.objectErrors += failed.length;
    if (failed.length > 0) {
      console.error("Nettoyage : objets non supprimés, transferts conservés pour réessayer :", failed);
    }

    // Seuls les transferts dont TOUS les objets ont disparu perdent leur document : pour les autres, les
    // storageKey restent la seule piste pour réessayer.
    const failedKeys = new Set(failed.map(({ key }) => key));
    const cleanedIds = batch
      .filter((transfer) => transfer.files.every((file) => !failedKeys.has(file.storageKey)))
      .map((transfer) => transfer._id);
    if (cleanedIds.length > 0) {
      // La condition d'expiration est répétée : par précaution, jamais de suppression d'un transfert non expiré.
      const { deletedCount } = await Transfer.deleteMany({
        _id: { $in: cleanedIds },
        expiresAt: { $lte: cutoff },
      });
      report.transfers += deletedCount;
    }
  }
}
