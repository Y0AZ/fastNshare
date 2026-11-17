// Teste la logique de l'onglet « Recevoir » : nettoyage de la saisie, états, choix du message d'erreur.
import { describe, expect, it } from "vitest";
import type { ApiError } from "./api";
import {
  hasInvalidCharacters,
  initialReceiveState,
  isCompleteCode,
  normalizeCodeInput,
  receiveErrorMessage,
  receiveReducer,
} from "./receive-state";

describe("normalizeCodeInput", () => {
  it.each([
    ["abcd2345", "ABCD2345"],
    ["  abcd 2345  ", "ABCD2345"],
    ["ABCD-2345", "ABCD2345"],
    ["abcd\t23\n45", "ABCD2345"],
    // Un collage trop long est coupé APRÈS nettoyage : les espaces ne mangent pas de caractères utiles.
    ["ABCD 2345 XYZ", "ABCD2345"],
  ])("%j → %j", (raw, expected) => {
    expect(normalizeCodeInput(raw)).toBe(expected);
  });
});

describe("validité du code", () => {
  it("accepte un code complet de l'alphabet", () => {
    expect(isCompleteCode("ABCD2345")).toBe(true);
  });

  it.each(["ABCD234", "ABCD234O", "ABCDI234", "ABCD2340"])("refuse %j", (code) => {
    expect(isCompleteCode(code)).toBe(false);
  });

  it("repère les caractères qui n'existent pas dans les codes (0, O, 1, I, L)", () => {
    expect(hasInvalidCharacters("ABC")).toBe(false);
    expect(hasInvalidCharacters("ABO")).toBe(true);
    expect(hasInvalidCharacters("L1")).toBe(true);
  });
});

describe("receiveReducer", () => {
  it("suit un téléchargement jusqu'au bout", () => {
    let state = receiveReducer(initialReceiveState, { type: "start" });
    expect(state).toEqual({ status: "downloading", progress: 0 });

    state = receiveReducer(state, { type: "progress", percent: 60 });
    expect(state).toEqual({ status: "downloading", progress: 60 });

    state = receiveReducer(state, { type: "succeed", filename: "fastshare-ABCD2345.zip" });
    expect(state).toEqual({ status: "done", filename: "fastshare-ABCD2345.zip" });
  });

  it("passe en erreur, puis repart de zéro", () => {
    const failed = receiveReducer(
      { status: "downloading", progress: 10 },
      { type: "fail", message: "Code inconnu." },
    );
    expect(failed).toEqual({ status: "error", message: "Code inconnu." });

    expect(receiveReducer(failed, { type: "start" })).toEqual({ status: "downloading", progress: 0 });
    expect(receiveReducer(failed, { type: "reset" })).toEqual({ status: "idle" });
  });

  it("ignore une progression ou une fin qui n'arrivent pas pendant un téléchargement", () => {
    expect(receiveReducer(initialReceiveState, { type: "progress", percent: 50 })).toBe(initialReceiveState);
    expect(receiveReducer(initialReceiveState, { type: "succeed", filename: "x.zip" })).toBe(
      initialReceiveState,
    );
  });
});

describe("receiveErrorMessage", () => {
  const http = (status: number, message: string, fromServer: boolean): ApiError => ({
    kind: "http",
    status,
    message,
    fromServer,
  });

  // Le serveur dit plus précisément ce qui se passe que le message de repli.
  it("reprend le message du serveur quand il existe", () => {
    expect(receiveErrorMessage(http(410, "Ce transfert a déjà été téléchargé.", true))).toBe(
      "Ce transfert a déjà été téléchargé.",
    );
    expect(receiveErrorMessage(http(429, "Trop de tentatives : réessayez dans 12 min.", true))).toBe(
      "Trop de tentatives : réessayez dans 12 min.",
    );
  });

  it.each([
    [404, "Code inconnu : vérifiez le code saisi."],
    [410, "Ce transfert a expiré ou a déjà été téléchargé."],
    [429, "Trop de tentatives : réessayez dans quelques minutes."],
  ])("donne un message dédié au %i quand le serveur n'en fournit pas", (status, expected) => {
    expect(receiveErrorMessage(http(status, "Le serveur a répondu par une erreur inattendue.", false))).toBe(
      expected,
    );
  });

  it("garde le message générique pour les autres cas (réseau, autres statuts)", () => {
    expect(receiveErrorMessage({ kind: "network", message: "Impossible de joindre le serveur." })).toBe(
      "Impossible de joindre le serveur.",
    );
    expect(receiveErrorMessage(http(502, "Erreur inattendue (HTTP 502).", false))).toBe(
      "Erreur inattendue (HTTP 502).",
    );
  });
});
