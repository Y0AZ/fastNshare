// Règles métier centralisées (section 5.4 du plan) : une seule source de vérité, appliquée côté serveur.
// Chaque tâche ajoute ici les limites qu'elle met en œuvre (rate limit en T2.4…).

// 8 caractères : assez court pour être dicté ou recopié, assez long pour rendre la devinette irréaliste
// (31^8 ≈ 852 milliards de combinaisons, à comparer aux 20 essais / 15 min autorisés par IP en T2.4).
export const CODE_LENGTH = 8;

// Sans 0/O, 1/I/L : les caractères qu'on confond à l'écrit ou à l'oral sont exclus. 8 chiffres + 23 lettres = 31.
export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

// 1 Mo = 1024 × 1024 octets (convention des systèmes de fichiers : un fichier affiché « 200 Mo » passe).
const MEGABYTE = 1024 * 1024;

export const MAX_FILE_SIZE_BYTES = 200 * MEGABYTE;
export const MAX_FILES_PER_TRANSFER = 20;
// Plafond du cumul : 20 fichiers de 200 Mo resteraient sinon possibles (4 Go par envoi).
export const MAX_TRANSFER_SIZE_BYTES = 500 * MEGABYTE;

// Durée maximale de réception d'une requête entière. Le défaut de Node (5 min) couperait un envoi de 500 Mo
// sous ~14 Mbit/s ; 30 min le permettent dès ~2,3 Mbit/s, tout en bornant une connexion qui traîne exprès.
export const REQUEST_TIMEOUT_MS = 30 * 60 * 1000;

export const TRANSFER_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_DOWNLOADS = 1;

// Pour les messages d'erreur : les limites sont en octets dans le code, en Mo pour l'utilisateur.
export function formatMegabytes(bytes: number): string {
  return `${Math.round(bytes / MEGABYTE)} Mo`;
}
