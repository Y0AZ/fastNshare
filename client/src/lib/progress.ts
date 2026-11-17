// Règles d'affichage d'une progression, séparées du composant ProgressBubble (Fast Refresh de Vite n'accepte
// que des composants dans un fichier de composant) et réutilisables par les onglets Envoyer et Recevoir.

import { NO_BREAK_SPACE } from "./format";

export const FINALIZING_LABEL = "Finalisation…";

// Entier entre 0 et 100. NaN (division par zéro en amont…) vaut 0 plutôt que de casser le rendu.
export function clampPercent(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.round(Math.min(100, Math.max(0, value)));
}

// « 50 % » avec une espace insécable (typographie française) : le nombre et « % » ne sont jamais séparés
// par un retour à la ligne.
export function formatPercent(percent: number): string {
  return `${percent}${NO_BREAK_SPACE}%`;
}
