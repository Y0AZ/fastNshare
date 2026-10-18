// Derniers middlewares de l'app : transforment toute erreur (et toute route inconnue) en réponse JSON { error }.
import type { ErrorRequestHandler, RequestHandler } from "express";
import { HttpError, notFound } from "./http-error.js";

// Monté après toutes les routes : sans lui, Express répondrait à une URL inconnue par une page HTML.
export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(notFound("Route introuvable."));
};

// Express reconnaît un gestionnaire d'erreurs à ses QUATRE paramètres : `_next` doit rester déclaré
// même s'il ne sert que dans un cas. Express 5 y envoie aussi les rejets de promesses des handlers async.
export const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  // Les en-têtes sont déjà partis (ex. un ZIP en cours d'envoi) : impossible de changer le statut ou d'écrire
  // du JSON. Le gestionnaire par défaut d'Express coupe alors la connexion, seul signal d'échec encore possible.
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message });
    return;
  }

  // Erreur inattendue : le détail (message, pile) va dans les logs, jamais au client, à qui il pourrait
  // révéler des informations internes (chemins, requêtes, versions).
  console.error("Erreur non gérée :", error);
  res.status(500).json({ error: "Une erreur interne est survenue. Réessayez plus tard." });
};
