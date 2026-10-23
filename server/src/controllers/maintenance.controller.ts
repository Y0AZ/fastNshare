// Contrôleur de maintenance : expose le nettoyage des transferts expirés à un déclencheur externe (T6.5).
import type { RequestHandler } from "express";
import { cleanupExpiredTransfers } from "../jobs/cleanup.js";
import type { Storage } from "../libs/storage.js";

export function createMaintenanceController(storage: Storage) {
  // Rapport chiffré renvoyé tel quel : le déclencheur planifié (GitHub Actions) l'affiche dans ses logs.
  const cleanup: RequestHandler = async (_req, res) => {
    const report = await cleanupExpiredTransfers(storage);
    console.log("Nettoyage terminé :", report);
    res.json(report);
  };

  return { cleanup };
}
