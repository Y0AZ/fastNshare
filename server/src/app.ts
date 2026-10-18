// Construit l'application Express sans ouvrir de port : importable telle quelle par les tests (Supertest).
import express, { type Express } from "express";
import type { Storage } from "./libs/storage.js";
import { errorHandler, notFoundHandler } from "./middlewares/error-handler.js";
import { createTransfersRouter } from "./routes/transfers.routes.js";

// Les dépendances sont passées en paramètre plutôt qu'importées : server.ts fournit le vrai stockage S3,
// les tests un stockage en mémoire, sans que l'app sache lequel elle utilise.
export type AppDependencies = {
  storage: Storage;
};

// Une fabrique plutôt qu'une instance partagée : chaque test obtient une app neuve, et la configuration
// (CORS, limites…) pourra lui être passée en paramètre sans dépendre de process.env.
export function createApp({ storage }: AppDependencies): Express {
  const app = express();

  // Masque l'en-tête « X-Powered-By: Express » : inutile de dire au monde quel framework on utilise.
  app.disable("x-powered-by");

  // Sonde de disponibilité : utilisée par Render (health check), par le client pour réveiller le serveur (T4.7)
  // et par la CI. Elle ne touche ni Mongo ni S3 : elle dit seulement que le processus répond.
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api/transfers", createTransfersRouter(storage));

  // Toujours en dernier, dans cet ordre : route inconnue → 404, puis conversion de toute erreur en JSON.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
