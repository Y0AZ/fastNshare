// Capacités graphiques du navigateur : elles décident si la bulle peut afficher l'effet WebGL ou doit garder le
// rendu SVG (dégradation progressive : tout le monde voit une bulle, seuls les navigateurs capables voient l'effet).
import { useSyncExternalStore } from "react";

let webgl2Support: boolean | undefined;

// Testé une seule fois puis mémorisé : créer un contexte WebGL coûte cher, et les navigateurs en limitent le nombre.
// Le contexte d'essai est rendu aussitôt (loseContext) pour ne pas occuper une de ces places.
export function supportsWebGL2(): boolean {
  if (webgl2Support === undefined) {
    try {
      const gl = document.createElement("canvas").getContext("webgl2");
      webgl2Support = gl !== null;
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      webgl2Support = false;
    }
  }
  return webgl2Support;
}

// Pour les tests : oublier le résultat mémorisé.
export function resetWebGL2SupportCache(): void {
  webgl2Support = undefined;
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

// Préférence système « réduire les animations », suivie EN DIRECT : si l'utilisateur la change pendant un envoi,
// la bulle bascule aussitôt. Navigateur sans matchMedia (ancien, ou jsdom en test) : aucune préférence.
function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia?.(REDUCED_MOTION_QUERY);
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia?.(REDUCED_MOTION_QUERY).matches ?? false);
}
