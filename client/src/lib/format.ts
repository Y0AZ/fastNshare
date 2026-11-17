// Mise en forme française des valeurs affichées : tailles de fichiers, dates.

// Espace insécable écrit par son code : un caractère invisible dans le source serait illisible à la relecture.
// Elle lie un nombre à son unité (« 12,4 Mo », « 50 % ») : jamais de retour à la ligne entre les deux.
export const NO_BREAK_SPACE = String.fromCharCode(0xa0);

const UNITS = ["o", "Ko", "Mo", "Go"];
const decimal = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });

// Même convention que le serveur : 1 Mo = 1024 × 1024 octets. Un fichier de 200 Mo affiché ici passe la limite.
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${decimal.format(value)}${NO_BREAK_SPACE}${UNITS[unit]}`;
}

const dateFormat = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short" });

// Date ISO renvoyée par l'API → « 1 décembre 2026 à 10:30 », dans le fuseau horaire du navigateur.
export function formatDateTime(iso: string): string {
  return dateFormat.format(new Date(iso));
}

const seconds = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// Durée écoulée en millisecondes → « 4,2 s » (virgule décimale française, espace insécable avant l'unité).
export function formatSeconds(milliseconds: number): string {
  return `${seconds.format(milliseconds / 1000)}${NO_BREAK_SPACE}s`;
}
