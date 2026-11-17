// Machine à états de l'onglet « Envoyer » : idle → ready → uploading → finalizing → done | error.
// Fonction pure (reducer) : chaque transition se teste sans navigateur ni serveur, et un état impossible (un code
// affiché pendant un envoi, une progression sans fichiers…) ne peut pas être représenté.
import { MAX_FILE_SIZE_BYTES, MAX_FILES_PER_TRANSFER, MAX_TRANSFER_SIZE_BYTES } from "./config";
import { formatBytes } from "./format";

export type SendState =
  | { status: "idle" }
  | { status: "ready"; files: File[] }
  | { status: "uploading"; files: File[]; progress: number }
  // Le navigateur a tout envoyé ; le serveur écrit encore vers S3 et enregistre le transfert.
  | { status: "finalizing"; files: File[] }
  | { status: "done"; code: string; expiresAt: string }
  // Les fichiers sont gardés : l'utilisateur peut corriger sa sélection ou réessayer sans tout rechoisir.
  | { status: "error"; files: File[]; message: string };

export type SendAction =
  | { type: "add"; files: File[] }
  | { type: "remove"; index: number }
  | { type: "start" }
  | { type: "progress"; percent: number }
  | { type: "succeed"; code: string; expiresAt: string }
  | { type: "fail"; message: string }
  | { type: "reset" };

export const initialSendState: SendState = { status: "idle" };

// Un même fichier choisi deux fois (nouvelle sélection, glisser-déposer) n'est gardé qu'une fois.
const sameFile = (a: File, b: File) =>
  a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;

function withAdded(current: File[], added: File[]): File[] {
  const merged = [...current];
  for (const file of added) if (!merged.some((kept) => sameFile(kept, file))) merged.push(file);
  return merged;
}

// Une action qui n'a pas de sens dans l'état courant (ajouter des fichiers pendant un envoi, recevoir une
// progression après la fin…) est ignorée : l'état reste cohérent quoi qu'envoient les événements.
export function sendReducer(state: SendState, action: SendAction): SendState {
  switch (action.type) {
    case "add": {
      if (state.status === "uploading" || state.status === "finalizing" || state.status === "done")
        return state;
      const current = state.status === "idle" ? [] : state.files;
      const files = withAdded(current, action.files);
      return files.length === 0 ? { status: "idle" } : { status: "ready", files };
    }
    case "remove": {
      if (state.status !== "ready" && state.status !== "error") return state;
      const files = state.files.filter((_file, index) => index !== action.index);
      return files.length === 0 ? { status: "idle" } : { status: "ready", files };
    }
    case "start":
      if (state.status !== "ready" && state.status !== "error") return state;
      return { status: "uploading", files: state.files, progress: 0 };
    case "progress":
      if (state.status !== "uploading") return state;
      // 100 % envoyés ne veut pas dire « terminé » : on attend la réponse du serveur.
      return action.percent >= 100
        ? { status: "finalizing", files: state.files }
        : { status: "uploading", files: state.files, progress: action.percent };
    case "succeed":
      if (state.status !== "uploading" && state.status !== "finalizing") return state;
      return { status: "done", code: action.code, expiresAt: action.expiresAt };
    case "fail":
      if (state.status !== "uploading" && state.status !== "finalizing") return state;
      return { status: "error", files: state.files, message: action.message };
    case "reset":
      return initialSendState;
  }
}

// Contrôle des limites AVANT l'envoi, pour le confort : mieux vaut prévenir que laisser envoyer 300 Mo pour
// rien. Le serveur reste juge (section 5.4) ; ce contrôle ne fait que refléter ses règles.
export function selectionProblem(files: File[]): string | undefined {
  if (files.length > MAX_FILES_PER_TRANSFER) {
    return `Trop de fichiers : ${MAX_FILES_PER_TRANSFER} au maximum par transfert (${files.length} sélectionnés).`;
  }
  const tooBig = files.find((file) => file.size > MAX_FILE_SIZE_BYTES);
  if (tooBig) {
    return `« ${tooBig.name} » dépasse la taille maximale de ${formatBytes(MAX_FILE_SIZE_BYTES)} par fichier.`;
  }
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > MAX_TRANSFER_SIZE_BYTES) {
    return `L'ensemble dépasse ${formatBytes(MAX_TRANSFER_SIZE_BYTES)} (${formatBytes(total)} sélectionnés).`;
  }
  return undefined;
}
