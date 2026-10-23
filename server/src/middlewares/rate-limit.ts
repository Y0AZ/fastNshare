// Limitation du nombre de requêtes par IP sur le téléchargement : rend l'énumération des codes irréaliste.
import type { RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import { DOWNLOAD_RATE_LIMIT, DOWNLOAD_RATE_WINDOW_MS } from "../configs/limits.js";
import { HttpError } from "./http-error.js";

type RateLimitOptions = { limit: number; windowMs: number };

// Compteurs en mémoire du processus (store par défaut) : suffisant pour une seule instance Render. Avec
// plusieurs instances, chacune compterait de son côté et la limite réelle serait multipliée par leur nombre.
// Toutes les requêtes comptent, y compris les 404 : c'est précisément l'essai de codes au hasard qu'on freine.
export function createDownloadRateLimit(
  { limit, windowMs }: RateLimitOptions = { limit: DOWNLOAD_RATE_LIMIT, windowMs: DOWNLOAD_RATE_WINDOW_MS },
): RequestHandler {
  return rateLimit({
    limit,
    windowMs,
    // En-têtes standard (RateLimit-Policy, RateLimit) plutôt que les anciens X-RateLimit-*. Dans les deux cas,
    // express-rate-limit pose Retry-After sur la réponse 429 : le client sait combien de temps attendre.
    standardHeaders: "draft-8",
    legacyHeaders: false,
    // Confié au gestionnaire d'erreurs : même format JSON { error } que le reste de l'API.
    // Le délai affiché est tiré de Retry-After (en secondes), déjà posé à cet instant : message et en-tête concordent.
    handler: (_req, res, next) => {
      const retryAfterSeconds = Number(res.getHeader("Retry-After")) || windowMs / 1000;
      const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
      next(new HttpError(429, `Trop de tentatives : réessayez dans ${minutes} min.`));
    },
  });
}
