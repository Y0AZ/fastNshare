// Erreurs HTTP « attendues » : levées volontairement par les contrôleurs, avec un statut et un message affichable.
// Toute autre erreur est traitée comme un bug ou une panne par le gestionnaire d'erreurs (réponse 500 générique).

export class HttpError extends Error {
  constructor(
    readonly status: number,
    // Message destiné à l'utilisateur final, en français : il est renvoyé tel quel dans { error }.
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

// Fabriques nommées : `throw notFound("…")` se lit mieux qu'un code numérique, et les messages par défaut
// restent cohérents dans toute l'API.
export const badRequest = (message = "Requête invalide.") => new HttpError(400, message);

export const notFound = (message = "Ressource introuvable.") => new HttpError(404, message);

// 410 plutôt que 404 : la ressource a existé mais n'est plus disponible (transfert expiré ou déjà téléchargé).
export const gone = (message = "Cette ressource n'est plus disponible.") => new HttpError(410, message);

export const payloadTooLarge = (message = "Envoi trop volumineux.") => new HttpError(413, message);
