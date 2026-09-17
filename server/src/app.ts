// Construit l'application Express sans ouvrir de port : importable telle quelle par les tests (Supertest).
import express, { type Express } from "express";

// Une fabrique plutôt qu'une instance partagée : chaque test obtient une app neuve, et la configuration
// (CORS, limites…) pourra lui être passée en paramètre sans dépendre de process.env.
export function createApp(): Express {
  const app = express();

  // Masque l'en-tête « X-Powered-By: Express » : inutile de dire au monde quel framework on utilise.
  app.disable("x-powered-by");

  // Sonde de disponibilité : utilisée par Render (health check), par le client pour réveiller le serveur (T4.7)
  // et par la CI. Elle ne touche ni Mongo ni S3 : elle dit seulement que le processus répond.
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  return app;
}
