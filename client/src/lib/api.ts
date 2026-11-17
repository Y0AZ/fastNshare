// Client de l'API : SEUL module à faire des requêtes HTTP. Les composants appellent ces fonctions typées et ne
// connaissent ni axios, ni les URL, ni le format des erreurs du serveur.
import axios, { type AxiosProgressEvent, isAxiosError, isCancel } from "axios";
import { API_URL } from "./config";

export const api = axios.create({ baseURL: API_URL });

export type CreatedTransfer = { code: string; expiresAt: string };
export type DownloadedTransfer = { blob: Blob; filename: string };
type RequestOptions = { onProgress?: (percent: number) => void; signal?: AbortSignal };

// Pourcentage entier 0–100, ou undefined si la taille totale est inconnue (pas de Content-Length).
export function toPercent({ loaded, total }: AxiosProgressEvent): number | undefined {
  if (!total) return undefined;
  return Math.min(100, Math.round((loaded / total) * 100));
}

const reportProgress = (onProgress?: (percent: number) => void) => (event: AxiosProgressEvent) => {
  const percent = toPercent(event);
  if (percent !== undefined) onProgress?.(percent);
};

// onUploadProgress mesure ce que le NAVIGATEUR a envoyé : 100 % ne veut pas dire « terminé », le serveur doit
// encore finir d'écrire vers S3 et enregistrer le transfert. D'où l'état « Finalisation… » prévu en T4.5.
export async function createTransfer(files: File[], { onProgress, signal }: RequestOptions = {}) {
  const form = new FormData();
  for (const file of files) form.append("files", file, file.name);
  // Pas de Content-Type manuel : le navigateur le fixe lui-même avec la « boundary » qui sépare les fichiers.
  const { data } = await api.post<CreatedTransfer>("/api/transfers", form, {
    signal,
    onUploadProgress: reportProgress(onProgress),
  });
  return data;
}

// responseType "blob" : le ZIP est un binaire. En contrepartie, TOUT le corps arrive en Blob, y compris un message
// d'erreur JSON (404, 410…) : c'est readApiError qui le relit.
export async function downloadTransfer(code: string, { onProgress, signal }: RequestOptions = {}) {
  const response = await api.get<Blob>(`/api/transfers/${encodeURIComponent(code)}/download`, {
    responseType: "blob",
    signal,
    onDownloadProgress: reportProgress(onProgress),
  });
  const header: unknown = response.headers["content-disposition"];
  return {
    blob: response.data,
    // Repli indispensable : depuis une autre origine, le navigateur ne laisse lire Content-Disposition que si le
    // serveur l'autorise (Access-Control-Expose-Headers). Le nom reste alors le même que celui du serveur.
    filename:
      filenameFromContentDisposition(typeof header === "string" ? header : undefined) ??
      `fastshare-${code}.zip`,
  } satisfies DownloadedTransfer;
}

// Réveille le serveur (hébergement gratuit endormi après inactivité, T4.7) : seule la réponse compte.
export async function wakeServer(signal?: AbortSignal): Promise<void> {
  await api.get("/health", { signal });
}

// Nom de fichier annoncé par l'en-tête Content-Disposition. La forme filename*=UTF-8''… (encodée) prime sur
// filename="…", comme le prévoit la RFC 6266 : c'est elle qui porte les caractères non ASCII.
export function filenameFromContentDisposition(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const encoded = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded.trim());
    } catch {
      // Encodage invalide : on tente la forme simple.
    }
  }
  const plain = /filename\s*=\s*(?:"([^"]*)"|([^;]+))/i.exec(header);
  const name = (plain?.[1] ?? plain?.[2])?.trim();
  return name || undefined;
}

export type ApiError = {
  // network : aucune réponse (hors ligne, serveur arrêté, CORS refusé) ; http : réponse d'erreur du serveur ;
  // canceled : annulation volontaire (AbortSignal), à ne pas afficher comme une erreur.
  kind: "network" | "http" | "canceled" | "unknown";
  status?: number;
  message: string;
  // Vrai si `message` est celui du serveur ({ error }) ; faux s'il s'agit du texte générique de repli (page HTML
  // d'un proxy…) : le composant peut alors préférer un message adapté au statut.
  fromServer?: boolean;
};

// Transforme n'importe quelle erreur d'appel en message affichable. Async : en mode blob, le corps d'erreur est
// un Blob qu'il faut d'abord relire. Les composants peuvent ensuite affiner le message selon `status`.
export async function readApiError(error: unknown): Promise<ApiError> {
  if (isCancel(error)) return { kind: "canceled", message: "Opération annulée." };
  if (!isAxiosError(error)) return { kind: "unknown", message: "Une erreur inattendue est survenue." };
  if (!error.response) {
    return {
      kind: "network",
      message: "Impossible de joindre le serveur. Vérifiez votre connexion, puis réessayez.",
    };
  }
  const { status, data } = error.response;
  const fromServer = await serverMessage(data);
  return {
    kind: "http",
    status,
    message: fromServer ?? `Le serveur a répondu par une erreur inattendue (HTTP ${status}).`,
    fromServer: fromServer !== undefined,
  };
}

// Le serveur répond { error: "…" } (contrat d'API). Le corps peut arriver déjà décodé (objet), en texte, ou en
// Blob (mode blob) ; une page HTML (proxy, hébergeur en panne) ne contient pas ce champ : on renvoie undefined.
async function serverMessage(data: unknown): Promise<string | undefined> {
  if (data instanceof Blob) return serverMessage(await data.text());
  if (typeof data === "string") {
    try {
      return serverMessage(JSON.parse(data));
    } catch {
      return undefined;
    }
  }
  if (typeof data === "object" && data !== null && "error" in data && typeof data.error === "string") {
    return data.error;
  }
  return undefined;
}
