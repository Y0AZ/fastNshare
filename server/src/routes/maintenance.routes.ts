// Routes /api/maintenance : opérations d'exploitation, réservées au détenteur du jeton de maintenance.
import { Router } from "express";
import { createMaintenanceController } from "../controllers/maintenance.controller.js";
import type { Storage } from "../libs/storage.js";
import { requireMaintenanceToken } from "../middlewares/maintenance-token.js";

export function createMaintenanceRouter(storage: Storage, token: string): Router {
  const router = Router();
  const controller = createMaintenanceController(storage);

  // POST et non GET : l'appel supprime des données. Un GET peut être rejoué par un navigateur, un proxy
  // ou un outil d'aperçu de liens.
  router.post("/cleanup", requireMaintenanceToken(token), controller.cleanup);

  return router;
}
