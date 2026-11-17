// Teste la machine à états de l'envoi et le contrôle des limites, sans interface.
import { describe, expect, it } from "vitest";
import { MAX_FILE_SIZE_BYTES, MAX_FILES_PER_TRANSFER } from "./config";
import {
  initialSendState,
  selectionProblem,
  sendReducer,
  type SendAction,
  type SendState,
} from "./send-state";

const file = (name: string, size = 10, lastModified = 1) => {
  const created = new File(["x"], name, { lastModified });
  // La taille réelle importe peu ici : on la fixe sans allouer des Mo de contenu.
  Object.defineProperty(created, "size", { value: size });
  return created;
};
const a = file("a.txt");
const b = file("b.txt");

// Applique une suite d'actions à partir de l'état initial.
const run = (...actions: SendAction[]): SendState => actions.reduce(sendReducer, initialSendState);

describe("sendReducer", () => {
  it("passe de idle à ready en ajoutant des fichiers, puis revient à idle quand on les retire tous", () => {
    const ready = run({ type: "add", files: [a, b] });
    expect(ready).toEqual({ status: "ready", files: [a, b] });

    expect(sendReducer(ready, { type: "remove", index: 0 })).toEqual({ status: "ready", files: [b] });
    expect(run({ type: "add", files: [a] }, { type: "remove", index: 0 })).toEqual({ status: "idle" });
  });

  it("ignore un fichier déjà sélectionné (même nom, taille et date)", () => {
    const state = run({ type: "add", files: [a] }, { type: "add", files: [file("a.txt"), b] });

    expect(state).toEqual({ status: "ready", files: [a, b] });
  });

  it("suit l'envoi : uploading avec progression, puis finalizing à 100 %, puis done", () => {
    let state = run({ type: "add", files: [a] }, { type: "start" });
    expect(state).toEqual({ status: "uploading", files: [a], progress: 0 });

    state = sendReducer(state, { type: "progress", percent: 42 });
    expect(state).toEqual({ status: "uploading", files: [a], progress: 42 });

    state = sendReducer(state, { type: "progress", percent: 100 });
    expect(state).toEqual({ status: "finalizing", files: [a] });

    state = sendReducer(state, { type: "succeed", code: "ABCD2345", expiresAt: "2026-12-01T10:00:00.000Z" });
    expect(state).toEqual({ status: "done", code: "ABCD2345", expiresAt: "2026-12-01T10:00:00.000Z" });
  });

  it("garde les fichiers après un échec, pour corriger ou réessayer", () => {
    const failed = run(
      { type: "add", files: [a] },
      { type: "start" },
      { type: "fail", message: "Réseau coupé." },
    );
    expect(failed).toEqual({ status: "error", files: [a], message: "Réseau coupé." });

    expect(sendReducer(failed, { type: "start" })).toEqual({ status: "uploading", files: [a], progress: 0 });
    expect(sendReducer(failed, { type: "add", files: [b] })).toEqual({ status: "ready", files: [a, b] });
  });

  // Des événements tardifs ou hors de propos ne doivent jamais produire un état incohérent.
  it.each<[string, SendState, SendAction]>([
    [
      "ajouter pendant l'envoi",
      { status: "uploading", files: [a], progress: 10 },
      { type: "add", files: [b] },
    ],
    [
      "retirer pendant l'envoi",
      { status: "uploading", files: [a], progress: 10 },
      { type: "remove", index: 0 },
    ],
    ["démarrer sans fichiers", { status: "idle" }, { type: "start" }],
    [
      "une progression après la fin",
      { status: "done", code: "C", expiresAt: "" },
      { type: "progress", percent: 50 },
    ],
    ["un échec après la fin", { status: "done", code: "C", expiresAt: "" }, { type: "fail", message: "x" }],
    [
      "ajouter quand le code est affiché",
      { status: "done", code: "C", expiresAt: "" },
      { type: "add", files: [b] },
    ],
  ])("ignore l'action : %s", (_label, state, action) => {
    expect(sendReducer(state, action)).toBe(state);
  });

  it("repart de zéro avec « reset »", () => {
    expect(sendReducer({ status: "done", code: "C", expiresAt: "" }, { type: "reset" })).toEqual({
      status: "idle",
    });
  });
});

describe("selectionProblem", () => {
  it("accepte une sélection dans les limites", () => {
    expect(selectionProblem([a, b])).toBeUndefined();
  });

  it("signale trop de fichiers", () => {
    const files = Array.from({ length: MAX_FILES_PER_TRANSFER + 1 }, (_, i) => file(`f${i}.txt`));

    expect(selectionProblem(files)).toBe("Trop de fichiers : 20 au maximum par transfert (21 sélectionnés).");
  });

  it("signale un fichier trop gros, en le nommant", () => {
    expect(selectionProblem([a, file("film.mp4", MAX_FILE_SIZE_BYTES + 1)])).toMatch(
      /^« film\.mp4 » dépasse la taille maximale de 200.Mo par fichier\.$/,
    );
  });

  it("signale un total trop lourd, même si chaque fichier passe", () => {
    const files = [1, 2, 3].map((i) => file(`part${i}.bin`, 180 * 1024 * 1024));

    expect(selectionProblem(files)).toMatch(/^L'ensemble dépasse 500.Mo \(540.Mo sélectionnés\)\.$/);
  });
});
