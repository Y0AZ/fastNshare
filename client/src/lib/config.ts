// Configuration du client : adresse de l'API et règles du service (section 5.4 du plan).

// Repli sur le serveur local quand VITE_API_URL est absente (client/.env non créé, tests, CI). En production,
// Vercel doit la fournir (T6.4) : sans elle, le navigateur viserait localhost et tous les appels échoueraient.
export const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

// Règles reprises du serveur (server/src/configs/limits.ts). Le serveur seul les APPLIQUE ; le client s'en sert
// pour prévenir l'utilisateur avant l'envoi et pour les afficher. Si elles changent côté serveur, les reporter
// ici, sinon l'interface promettrait autre chose que ce que l'API accepte.
const MEGABYTE = 1024 * 1024;
export const MAX_FILE_SIZE_BYTES = 200 * MEGABYTE;
export const MAX_FILES_PER_TRANSFER = 20;
export const MAX_TRANSFER_SIZE_BYTES = 500 * MEGABYTE;
export const TRANSFER_TTL_DAYS = 7;
export const MAX_DOWNLOADS = 1;
export const CODE_LENGTH = 8;
export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
