// Onglet « Recevoir » : saisie du code, téléchargement du ZIP avec la bulle de progression, enregistrement du
// fichier sur l'appareil.
import { useEffect, useReducer, useState, type FormEvent } from "react";
import { CircleCheck, Download } from "lucide-react";
import { ProgressBubble } from "@/components/ProgressBubble";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { downloadTransfer, readApiError } from "@/lib/api";
import { CODE_LENGTH } from "@/lib/config";
import {
  hasInvalidCharacters,
  initialReceiveState,
  isCompleteCode,
  normalizeCodeInput,
  receiveErrorMessage,
  receiveReducer,
} from "@/lib/receive-state";

// Enregistre un Blob déjà en mémoire comme un fichier : une URL d'objet (blob:…) pointe vers lui, un lien
// <a download> la « clique », puis l'URL est libérée pour que le navigateur puisse rendre la mémoire.
// Libération différée : révoquer dans la foulée du clic peut interrompre l'enregistrement dans certains navigateurs.
function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ReceiveTab() {
  const [code, setCode] = useState("");
  const [state, dispatch] = useReducer(receiveReducer, initialReceiveState);
  const downloading = state.status === "downloading";
  const invalid = hasInvalidCharacters(code);

  // Quitter la page pendant le téléchargement l'interromprait (le serveur rendrait alors le téléchargement).
  useEffect(() => {
    if (!downloading) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [downloading]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!isCompleteCode(code) || downloading) return;
    dispatch({ type: "start" });
    try {
      // Limite connue du MVP : tout le ZIP (jusqu'à 500 Mo) est reçu en mémoire avant d'être enregistré.
      const { blob, filename } = await downloadTransfer(code, {
        onProgress: (percent) => dispatch({ type: "progress", percent }),
      });
      saveBlob(blob, filename);
      dispatch({ type: "succeed", filename });
    } catch (error) {
      dispatch({ type: "fail", message: receiveErrorMessage(await readApiError(error)) });
    }
  }

  function reset() {
    setCode("");
    dispatch({ type: "reset" });
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        {/* Même bulle que pour l'envoi, toujours présente et à la même place : inerte au repos et après le
            téléchargement, active et grande pendant. */}
        <div className="flex flex-col items-center gap-3">
          <ProgressBubble
            value={downloading ? state.progress : undefined}
            label="Progression du téléchargement"
            className={downloading ? "w-56" : "w-36 opacity-80"}
          />
          {downloading && <p className="text-sm text-muted-foreground">Téléchargement des fichiers…</p>}
        </div>
        {downloading ? null : state.status === "done" ? (
          <div className="flex flex-col items-center gap-3 text-center">
            <CircleCheck className="size-10 text-primary" aria-hidden />
            <p className="font-medium">Téléchargement terminé</p>
            <p className="text-sm break-all text-muted-foreground">{state.filename}</p>
            <p className="text-sm text-muted-foreground">Ce code ne peut plus être utilisé.</p>
            <Button variant="ghost" onClick={reset}>
              Recevoir un autre transfert
            </Button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <label htmlFor="code" className="text-sm text-muted-foreground">
              Saisissez le code de {CODE_LENGTH} caractères reçu de l'expéditeur :
            </label>
            <Input
              id="code"
              value={code}
              onChange={(event) => setCode(normalizeCodeInput(event.target.value))}
              placeholder="ABCD2345"
              // Pas d'aide à la saisie : un code n'est ni un mot à corriger, ni une donnée à mémoriser.
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="characters"
              spellCheck={false}
              aria-invalid={invalid}
              aria-describedby={invalid ? "code-aide" : undefined}
              // md:text-2xl explicite : le composant Input impose md:text-sm, que text-2xl seul ne remplace pas
              // (tailwind-merge ne fusionne que des classes de même préfixe).
              className="h-12 text-center font-mono text-2xl tracking-[0.3em] uppercase md:text-2xl"
            />
            {invalid && (
              <p id="code-aide" className="text-sm text-destructive">
                Les codes n'utilisent ni 0, ni O, ni 1, ni I, ni L : vérifiez ces caractères.
              </p>
            )}
            {state.status === "error" && (
              <Alert variant="destructive">
                <AlertDescription>{state.message}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" size="lg" disabled={!isCompleteCode(code)}>
              <Download aria-hidden />
              Télécharger
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
