// Réveil du serveur au chargement de la page. Hébergé gratuitement (Render), il s'endort après une période
// d'inactivité ; la première requête le redémarre, ce qui peut prendre jusqu'à une minute (« cold start »).
// Ce hook décrit l'ÉTAT DU SERVEUR, pour un bandeau ; il ne bloque rien : un envoi lancé pendant le réveil attend
// simplement sa réponse, avec sa propre progression.
import { useEffect, useState } from "react";
import { wakeServer } from "./api";

export type ServerStatus =
  // Premier appel en cours, depuis moins que le délai : on ne dit rien (cas normal : serveur déjà éveillé).
  | "checking"
  // La réponse tarde : le serveur est probablement en train de redémarrer.
  | "waking"
  | "ready"
  // Aucune réponse au bout du délai maximal : panne ou réseau coupé, plus un simple réveil.
  | "unreachable";

type Options = {
  // Au-delà, on prévient l'utilisateur (« quelques secondes » du plan).
  slowAfterMs?: number;
  // Pendant un réveil ou un redéploiement, la requête peut échouer (502, réseau) : on réessaie.
  retryEveryMs?: number;
  // Un réveil Render dure jusqu'à ~1 min : au-delà de 90 s, ce n'en est plus un.
  giveUpAfterMs?: number;
};

export function useServerWake({
  slowAfterMs = 3000,
  retryEveryMs = 5000,
  giveUpAfterMs = 90_000,
}: Options = {}): ServerStatus {
  const [status, setStatus] = useState<ServerStatus>("checking");

  useEffect(() => {
    const controller = new AbortController();
    const startedAt = Date.now();
    let retryTimer: number | undefined;
    const slowTimer = window.setTimeout(
      () => setStatus((current) => (current === "checking" ? "waking" : current)),
      slowAfterMs,
    );

    const attempt = async () => {
      try {
        await wakeServer(controller.signal);
        window.clearTimeout(slowTimer);
        setStatus("ready");
      } catch {
        // Page quittée (démontage) : la requête a été annulée volontairement, il n'y a plus rien à faire.
        if (controller.signal.aborted) return;
        if (Date.now() - startedAt >= giveUpAfterMs) {
          window.clearTimeout(slowTimer);
          setStatus("unreachable");
          return;
        }
        retryTimer = window.setTimeout(attempt, retryEveryMs);
      }
    };
    void attempt();

    return () => {
      controller.abort();
      window.clearTimeout(slowTimer);
      window.clearTimeout(retryTimer);
    };
  }, [slowAfterMs, retryEveryMs, giveUpAfterMs]);

  return status;
}
