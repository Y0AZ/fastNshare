// Protège les routes de maintenance : seul un appelant qui présente le bon jeton (x-maintenance-token) passe.
import { createHash, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { forbidden } from "./http-error.js";

export const MAINTENANCE_TOKEN_HEADER = "x-maintenance-token";

// Comparaison en temps constant : `===` s'arrête au premier caractère différent, et un attaquant qui mesure
// le temps de réponse pourrait deviner le jeton caractère par caractère. timingSafeEqual parcourt toujours
// tout. Il exige deux tampons de même longueur : on compare donc les empreintes SHA-256 (32 octets chacune),
// ce qui évite aussi de révéler la longueur du vrai jeton.
export function tokensMatch(received: string, expected: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(received), digest(expected));
}

export function requireMaintenanceToken(expected: string): RequestHandler {
  return (req, _res, next) => {
    const received = req.get(MAINTENANCE_TOKEN_HEADER);
    // Jeton absent ou faux : même réponse, pour ne rien apprendre à l'appelant sur ce qui cloche.
    if (received === undefined || !tokensMatch(received, expected)) {
      next(forbidden("Jeton de maintenance invalide."));
      return;
    }
    next();
  };
}
