// Logique de l'onglet « Recevoir » : saisie du code, états du téléchargement, messages d'erreur dédiés.
import type { ApiError } from "./api";
import { CODE_ALPHABET, CODE_LENGTH } from "./config";

// Saisie → code : majuscules, sans espaces ni tirets (un code recopié « ABCD 2345 » ou « abcd-2345 » doit
// passer), limité à 8 caractères. Pas de maxLength sur le champ : il couperait un collage AVANT ce nettoyage.
export function normalizeCodeInput(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]/g, "").slice(0, CODE_LENGTH);
}

// Caractères absents de l'alphabet des codes (0, O, 1, I, L…) : souvent une confusion à la recopie.
export function hasInvalidCharacters(code: string): boolean {
  return [...code].some((char) => !CODE_ALPHABET.includes(char));
}

export function isCompleteCode(code: string): boolean {
  return code.length === CODE_LENGTH && !hasInvalidCharacters(code);
}

export type ReceiveState =
  | { status: "idle" }
  | { status: "downloading"; progress: number }
  | { status: "done"; filename: string }
  | { status: "error"; message: string };

export type ReceiveAction =
  | { type: "start" }
  | { type: "progress"; percent: number }
  | { type: "succeed"; filename: string }
  | { type: "fail"; message: string }
  | { type: "reset" };

export const initialReceiveState: ReceiveState = { status: "idle" };

export function receiveReducer(state: ReceiveState, action: ReceiveAction): ReceiveState {
  switch (action.type) {
    case "start":
      return state.status === "downloading" ? state : { status: "downloading", progress: 0 };
    case "progress":
      return state.status === "downloading" ? { status: "downloading", progress: action.percent } : state;
    case "succeed":
      return state.status === "downloading" ? { status: "done", filename: action.filename } : state;
    case "fail":
      return state.status === "downloading" ? { status: "error", message: action.message } : state;
    case "reset":
      return initialReceiveState;
  }
}

// Messages de repli par statut, si la réponse ne contient pas le message du serveur (page d'un proxy…).
const FALLBACK_BY_STATUS: Record<number, string> = {
  404: "Code inconnu : vérifiez le code saisi.",
  410: "Ce transfert a expiré ou a déjà été téléchargé.",
  429: "Trop de tentatives : réessayez dans quelques minutes.",
};

// Le message du serveur est préféré : il est plus précis que le repli (« a expiré » ou « a déjà été
// téléchargé », délai exact avant de réessayer après un 429).
export function receiveErrorMessage(error: ApiError): string {
  if (error.kind === "http" && !error.fromServer && error.status !== undefined) {
    return FALLBACK_BY_STATUS[error.status] ?? error.message;
  }
  return error.message;
}
