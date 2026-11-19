// Construit l'application Express sans ouvrir de port : importable telle quelle par les tests (Supertest).
import cors from "cors";
import express, { type Express } from "express";
import type { Storage } from "./libs/storage.js";
import type { UploadLimits } from "./middlewares/upload.js";
import { errorHandler, notFoundHandler } from "./middlewares/error-handler.js";
import { createMaintenanceRouter } from "./routes/maintenance.routes.js";
import { createTransfersRouter } from "./routes/transfers.routes.js";

// Les dépendances sont passées en paramètre plutôt qu'importées : server.ts fournit le vrai stockage S3,
// les tests un stockage en mémoire, sans que l'app sache lequel elle utilise.
export type AppDependencies = {
  storage: Storage;
  // Nombre de proxys de confiance (TRUST_PROXY) ; 0 par défaut : l'app est exposée directement.
  trustProxy?: number;
  // Jeton de maintenance (MAINTENANCE_TOKEN) ; absent → routes de maintenance non montées.
  maintenanceToken?: string;
  // Limites d'upload (section 5.4 par défaut) : les tests d'intégration les abaissent pour vérifier un 413
  // avec quelques Mo au lieu de 200.
  uploadLimits?: UploadLimits;
  // Origines autorisées à appeler l'API depuis un navigateur (CORS_ORIGIN) ; vide → CORS désactivé.
  corsOrigins?: string[];
};

// Une fabrique plutôt qu'une instance partagée : chaque test obtient une app neuve, et la configuration
// (CORS, limites…) pourra lui être passée en paramètre sans dépendre de process.env.
export function createApp({
  storage,
  trustProxy = 0,
  maintenanceToken,
  uploadLimits,
  corsOrigins = [],
}: AppDependencies): Express {
  const app = express();

  // trust proxy : derrière Render, la connexion vient du proxy de Render, pas du client. Sans ce réglage,
  // req.ip serait la même pour tout le monde et le rate limit bloquerait tous les utilisateurs à la fois.
  // Avec N, Express lit la vraie IP dans X-Forwarded-For en ne croyant que les N derniers relais.
  // false plutôt que 0 : express-rate-limit signale alors dans les logs un X-Forwarded-For reçu sans proxy
  // déclaré (indice d'un TRUST_PROXY oublié), mais seulement si c'est la toute première requête limitée.
  app.set("trust proxy", trustProxy > 0 ? trustProxy : false);

  // Masque l'en-tête « X-Powered-By: Express » : inutile de dire au monde quel framework on utilise.
  app.disable("x-powered-by");

  // CORS : le client (Vercel, ou localhost:5173 en développement) et l'API (Render, ou localhost:4000) sont sur
  // deux origines différentes. Le navigateur refuse alors de livrer les réponses au JavaScript du client, sauf si
  // l'API l'y autorise (Access-Control-Allow-Origin). Liste fermée plutôt que « * » : seul notre client est servi.
  // CORS ne protège pas l'API elle-même (curl l'ignore) : c'est une règle que le navigateur applique à ses pages.
  // Monté avant toutes les routes, /health compris : le client l'appelle aussi pour réveiller le serveur.
  if (corsOrigins.length > 0) {
    app.use(
      cors({
        origin: corsOrigins,
        // Depuis une autre origine, le JavaScript ne lit que quelques en-têtes « sûrs » (Content-Type,
        // Content-Length…). Content-Disposition porte le nom du ZIP, Retry-After le délai après un 429.
        exposedHeaders: ["Content-Disposition", "Retry-After"],
      }),
    );
  }

  // Sonde de disponibilité : utilisée par Render (health check), par le client pour réveiller le serveur (T4.7)
  // et par la CI. Elle ne touche ni Mongo ni S3 : elle dit seulement que le processus répond.
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api/transfers", createTransfersRouter(storage, uploadLimits));

  // Montée seulement si un jeton est configuré : sans jeton, la route n'existe pas (404) au lieu d'exister
  // sans protection, ou protégée par un jeton vide qu'il suffirait d'envoyer.
  if (maintenanceToken) {
    app.use("/api/maintenance", createMaintenanceRouter(storage, maintenanceToken));
  }

  // Toujours en dernier, dans cet ordre : route inconnue → 404, puis conversion de toute erreur en JSON.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
