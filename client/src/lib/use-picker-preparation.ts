// Détecte qu'un sélecteur de fichiers est refermé mais que le navigateur n'a pas encore remis les fichiers : c'est
// le cas quand on choisit une application ou un dossier « paquet » (.app…), que le navigateur compresse d'abord en
// .zip, parfois pendant plusieurs secondes. Sans indication, la page semblerait figée.
import { useCallback, useEffect, useRef, useState } from "react";

type Options = {
  // Sélection ordinaire : les fichiers arrivent presque aussitôt ; l'indication n'apparaît qu'après ce délai.
  delayMs?: number;
  // Filet de sécurité : un navigateur qui ne signale pas l'annulation laisserait sinon l'indication affichée.
  timeoutMs?: number;
};

export function usePickerPreparation({ delayMs = 300, timeoutMs = 120_000 }: Options = {}) {
  const [preparing, setPreparing] = useState(false);
  // Un sélecteur a été ouvert et rien n'est encore arrivé (ni fichiers, ni annulation).
  const waiting = useRef(false);
  const timers = useRef<number[]>([]);

  const clearTimers = () => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current = [];
  };

  // Fichiers reçus ou sélecteur annulé : fin de l'attente.
  const stop = useCallback(() => {
    waiting.current = false;
    clearTimers();
    setPreparing(false);
  }, []);

  // Appelé juste avant d'ouvrir le sélecteur.
  const start = useCallback(() => {
    waiting.current = true;
  }, []);

  // Le sélecteur natif fait perdre le focus à la fenêtre ; elle le retrouve quand il se ferme. Si les fichiers
  // ne sont toujours pas là un instant plus tard, c'est que le navigateur les prépare.
  useEffect(() => {
    const onFocus = () => {
      if (!waiting.current) return;
      clearTimers();
      timers.current.push(
        window.setTimeout(() => {
          if (waiting.current) setPreparing(true);
        }, delayMs),
        window.setTimeout(stop, timeoutMs),
      );
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearTimers();
    };
  }, [delayMs, timeoutMs, stop]);

  return { preparing, start, stop };
}
