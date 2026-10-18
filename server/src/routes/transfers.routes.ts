// Routes /api/transfers : associe chaque URL à sa chaîne de middlewares et à son contrôleur.
import { Router } from "express";
import { createTransfersController } from "../controllers/transfers.controller.js";
import type { Storage } from "../libs/storage.js";
import { HttpError } from "../middlewares/http-error.js";
import { createUploadMiddleware } from "../middlewares/upload.js";

export function createTransfersRouter(storage: Storage): Router {
  const router = Router();
  const controller = createTransfersController(storage);

  // L'upload (fichiers → S3) précède le contrôleur : celui-ci ne voit que des fichiers déjà stockés et validés.
  router.post("/", createUploadMiddleware(storage), controller.create);

  // Express sert automatiquement HEAD avec le handler GET : une simple requête HEAD (sonde, aperçu de lien)
  // consommerait alors l'unique téléchargement. Déclarée AVANT le GET, cette route l'intercepte.
  router.head("/:code/download", (_req, res) => {
    res.set("Allow", "GET");
    throw new HttpError(405, "Méthode non autorisée : utilisez GET.");
  });
  router.get("/:code/download", controller.download);

  return router;
}
