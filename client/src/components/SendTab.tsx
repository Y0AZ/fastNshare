// Onglet « Envoyer » : choix des fichiers (bouton ou glisser-déposer), envoi avec la bulle de progression,
// puis affichage du code à transmettre et bouton « Copier ».
import { useEffect, useReducer, useRef, useState, type DragEvent } from "react";
import { Check, Copy, FileIcon, RotateCcw, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { ProgressBubble } from "@/components/ProgressBubble";
import LatticeLoader from "@/components/react-bits/LatticeLoader";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createTransfer, readApiError } from "@/lib/api";
import { formatBytes, formatDateTime, formatSeconds } from "@/lib/format";
import { initialSendState, selectionProblem, sendReducer } from "@/lib/send-state";
import { usePickerPreparation } from "@/lib/use-picker-preparation";
import { cn } from "@/lib/utils";

export function SendTab() {
  const [state, dispatch] = useReducer(sendReducer, initialSendState);
  const busy = state.status === "uploading" || state.status === "finalizing";
  // Sélecteur refermé, fichiers pas encore remis par le navigateur (compression d'une application, d'un dossier).
  const picker = usePickerPreparation();
  const preparing = picker.preparing && !busy;

  // Quitter ou recharger la page pendant un envoi le perdrait : le navigateur demande confirmation.
  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  async function send(files: File[]) {
    dispatch({ type: "start" });
    try {
      const created = await createTransfer(files, {
        onProgress: (percent) => dispatch({ type: "progress", percent }),
      });
      dispatch({ type: "succeed", code: created.code, expiresAt: created.expiresAt });
    } catch (error) {
      // 400 et 413 : le serveur explique lui-même le problème (fichier trop gros, trop de fichiers…) ;
      // réseau coupé ou serveur injoignable : message de readApiError.
      dispatch({ type: "fail", message: (await readApiError(error)).message });
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        {/* La bulle, élément visuel phare, est toujours là, à la même place (la scène WebGL n'est jamais recréée).
            Au repos et après l'envoi : inerte, plus petite et un peu en retrait. Pendant l'envoi : active et grande. */}
        <div className="flex flex-col items-center gap-3">
          <ProgressBubble
            value={busy ? (state.status === "uploading" ? state.progress : 100) : undefined}
            finalizing={state.status === "finalizing"}
            preparing={preparing}
            className={busy ? "w-56" : preparing ? "w-44" : "w-36 opacity-80"}
          />
          {busy && (
            <p className="text-sm text-muted-foreground">
              {state.status === "finalizing"
                ? "Fichiers reçus, enregistrement du transfert…"
                : `Envoi de ${plural(state.files.length, "fichier")}…`}
            </p>
          )}
        </div>
        {state.status === "done" ? (
          <TransferCode
            code={state.code}
            expiresAt={state.expiresAt}
            onNew={() => dispatch({ type: "reset" })}
          />
        ) : busy ? null : (
          <Selection
            files={state.status === "idle" ? [] : state.files}
            error={state.status === "error" ? state.message : undefined}
            onAdd={(files) => dispatch({ type: "add", files })}
            onRemove={(index) => dispatch({ type: "remove", index })}
            onSend={send}
            preparing={preparing}
            onPickerOpen={picker.start}
            onPickerDone={picker.stop}
          />
        )}
      </CardContent>
    </Card>
  );
}

type SelectionProps = {
  files: File[];
  error: string | undefined;
  onAdd: (files: File[]) => void;
  onRemove: (index: number) => void;
  onSend: (files: File[]) => void;
  preparing: boolean;
  // Le sélecteur va s'ouvrir / il a rendu sa réponse (fichiers ou annulation).
  onPickerOpen: () => void;
  onPickerDone: () => void;
};

function Selection({
  files,
  error,
  onAdd,
  onRemove,
  onSend,
  preparing,
  onPickerOpen,
  onPickerDone,
}: SelectionProps) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const problem = selectionProblem(files);
  const total = files.reduce((sum, file) => sum + file.size, 0);

  // Un fichier lâché À CÔTÉ de la zone serait ouvert par le navigateur, qui quitterait l'application.
  useEffect(() => {
    const ignore = (event: globalThis.DragEvent) => event.preventDefault();
    window.addEventListener("dragover", ignore);
    window.addEventListener("drop", ignore);
    return () => {
      window.removeEventListener("dragover", ignore);
      window.removeEventListener("drop", ignore);
    };
  }, []);

  // Annulation du sélecteur (événement « cancel » du champ) : sans elle, l'indication de préparation resterait
  // affichée. Écouté ici, sur CE champ : il est recréé à chaque nouvel envoi.
  useEffect(() => {
    const element = input.current;
    element?.addEventListener("cancel", onPickerDone);
    return () => element?.removeEventListener("cancel", onPickerDone);
  }, [onPickerDone]);

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const { files: dropped, folders } = readDroppedFiles(event.dataTransfer);
    if (folders > 0) {
      toast.error("Les dossiers ne peuvent pas être envoyés : déposez les fichiers qu'ils contiennent.");
    }
    if (dropped.length > 0) onAdd(dropped);
  }

  return (
    <>
      <div
        // Nom accessible : la zone est annoncée par les lecteurs d'écran (et retrouvée ainsi par les tests).
        role="group"
        aria-label="Zone de dépôt des fichiers"
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        // relatedTarget : on ne quitte vraiment la zone que si le pointeur n'est pas passé sur un de ses enfants.
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={onDrop}
        className={cn(
          "flex flex-col items-center gap-3 rounded-xl border-2 border-dashed p-8 text-center transition-colors",
          dragging ? "border-primary bg-muted" : "border-border",
        )}
      >
        {preparing ? (
          <PreparingIndicator />
        ) : (
          <>
            <Upload className="size-8 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">Glissez vos fichiers ici, ou</p>
            <Button
              variant="outline"
              onClick={() => {
                onPickerOpen();
                input.current?.click();
              }}
            >
              Choisir des fichiers
            </Button>
          </>
        )}
        {/* Champ natif masqué : le bouton ci-dessus l'ouvre. `value` remis à zéro pour pouvoir reprendre
            le même fichier après l'avoir retiré. */}
        <input
          ref={input}
          type="file"
          multiple
          hidden
          aria-label="Choisir des fichiers"
          onChange={(event) => {
            onPickerDone();
            onAdd([...(event.target.files ?? [])]);
            event.target.value = "";
          }}
        />
      </div>

      {files.length > 0 && (
        <div className="flex flex-col gap-2">
          <ul aria-label="Fichiers sélectionnés" className="flex max-h-64 flex-col gap-1 overflow-y-auto">
            {files.map((file, index) => (
              <li
                key={`${file.name}-${file.size}-${file.lastModified}`}
                className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm"
              >
                <FileIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                {/* min-w-0 + truncate : un nom très long est coupé « … » au lieu d'élargir la carte. */}
                <span className="min-w-0 flex-1 truncate" title={file.name}>
                  {file.name}
                </span>
                <span className="shrink-0 text-muted-foreground tabular-nums">{formatBytes(file.size)}</span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Retirer ${file.name}`}
                  onClick={() => onRemove(index)}
                >
                  <X aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
          <p className="text-right text-sm text-muted-foreground">
            {plural(files.length, "fichier")} · {formatBytes(total)}
          </p>
        </div>
      )}

      {(problem ?? error) && (
        <Alert variant="destructive">
          <AlertDescription>{problem ?? error}</AlertDescription>
        </Alert>
      )}

      {files.length > 0 && (
        <Button size="lg" disabled={problem !== undefined} onClick={() => onSend(files)}>
          {error ? <RotateCcw aria-hidden /> : <Upload aria-hidden />}
          {error ? "Réessayer l'envoi" : "Envoyer"}
        </Button>
      )}
    </>
  );
}

// Pendant que le navigateur prépare les fichiers : la grille animée de React Bits et un chronomètre, pour montrer
// que l'application travaille. Le composant tiers parle anglais aux lecteurs d'écran (« in progress ») : il est
// masqué, et l'état est annoncé en français à côté. Son chronomètre (« 4.2s ») est remplacé par un format français.
function PreparingIndicator() {
  const [startedAt] = useState(() => performance.now());
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setElapsed(performance.now() - startedAt), 100);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  return (
    <div className="flex flex-col items-center gap-3 py-2">
      <p role="status" className="sr-only">
        Préparation des fichiers en cours…
      </p>
      <div aria-hidden className="flex items-center gap-3 text-foreground">
        <LatticeLoader label="Préparation des fichiers" showTimer={false} fontSize={15} />
        <span className="font-mono text-sm text-muted-foreground tabular-nums">{formatSeconds(elapsed)}</span>
      </div>
      <p className="text-xs text-muted-foreground">
        Le navigateur compresse les applications et dossiers choisis : cela peut prendre quelques secondes.
      </p>
    </div>
  );
}

function TransferCode({ code, expiresAt, onNew }: { code: string; expiresAt: string; onNew: () => void }) {
  const [copied, setCopied] = useState(false);

  // Clipboard API : réservée aux contextes sécurisés (https, ou localhost en développement). Si elle échoue,
  // le code reste sélectionnable d'un clic (select-all) pour une copie manuelle.
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success("Code copié dans le presse-papiers");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Copie impossible : sélectionnez le code et copiez-le manuellement.");
    }
  }

  return (
    <div className="flex flex-col items-center gap-4 py-4 text-center">
      <p className="text-sm text-muted-foreground">Transmettez ce code au destinataire :</p>
      <p
        aria-label="Code du transfert"
        className="font-mono text-4xl font-bold tracking-[0.2em] select-all sm:text-5xl"
      >
        {code}
      </p>
      <Button size="lg" onClick={copy}>
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        {copied ? "Copié" : "Copier le code"}
      </Button>
      <p className="text-sm text-muted-foreground">
        Valable jusqu'au {formatDateTime(expiresAt)}, téléchargeable une seule fois.
      </p>
      <Button variant="ghost" onClick={onNew}>
        Nouvel envoi
      </Button>
    </div>
  );
}

// Fichiers d'un glisser-déposer. Un dossier déposé apparaît comme un « fichier » vide qu'on ne peut pas lire :
// on le repère (webkitGetAsEntry, pris en charge par tous les navigateurs actuels) pour le signaler.
function readDroppedFiles(transfer: DataTransfer): { files: File[]; folders: number } {
  const files: File[] = [];
  let folders = 0;
  for (const item of transfer.items) {
    if (item.kind !== "file") continue;
    if (item.webkitGetAsEntry?.()?.isDirectory) {
      folders++;
      continue;
    }
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  return { files, folders };
}

const plural = (count: number, word: string) => `${count} ${word}${count > 1 ? "s" : ""}`;
