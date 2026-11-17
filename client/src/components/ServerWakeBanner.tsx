// Bandeau discret affiché quand le serveur tarde à répondre au chargement de la page (réveil d'un hébergement
// gratuit), pour qu'une attente d'une minute ne ressemble pas à une panne.
import { CloudOff, LoaderCircle } from "lucide-react";
import { useServerWake } from "@/lib/use-server-wake";

export function ServerWakeBanner() {
  const status = useServerWake();
  if (status !== "waking" && status !== "unreachable") return null;

  const waking = status === "waking";
  return (
    // role="status" : annoncé poliment par les lecteurs d'écran, sans interrompre ce qu'ils lisent.
    <div
      role="status"
      className="mx-auto flex w-full max-w-xl items-center justify-center gap-2 px-4 pb-4 text-center text-sm text-muted-foreground"
    >
      {waking ? (
        <LoaderCircle className="size-4 shrink-0 motion-safe:animate-spin" aria-hidden />
      ) : (
        <CloudOff className="size-4 shrink-0" aria-hidden />
      )}
      <p>
        {waking
          ? "Le serveur se réveille, cela peut prendre jusqu'à une minute."
          : "Le serveur ne répond pas pour le moment. Réessayez dans quelques minutes."}
      </p>
    </div>
  );
}
