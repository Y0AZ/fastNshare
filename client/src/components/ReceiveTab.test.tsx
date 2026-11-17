// Teste le parcours de réception : saisie du code, téléchargement avec la bulle, enregistrement du fichier
// depuis le Blob, et les messages d'erreur. L'API est simulée ; readApiError reste le vrai.
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DownloadedTransfer } from "@/lib/api";
import { ReceiveTab } from "./ReceiveTab";

const api = vi.hoisted(() => ({ downloadTransfer: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  downloadTransfer: api.downloadTransfer,
}));

// Erreur HTTP telle qu'axios la produit en mode blob : le corps JSON arrive lui aussi en Blob.
function httpError(status: number, body: unknown) {
  const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig;
  const data =
    body === undefined ? undefined : new Blob([JSON.stringify(body)], { type: "application/json" });
  return new AxiosError(
    "échec",
    "ERR_BAD_REQUEST",
    config,
    {},
    { status, statusText: "", headers: {}, config, data },
  );
}

// Téléchargement « en attente » : le test fait avancer la progression puis répond.
function pendingDownload() {
  let onProgress: (percent: number) => void = () => {};
  let finish: (result: DownloadedTransfer) => void = () => {};
  api.downloadTransfer.mockImplementation(
    (_code: string, options: { onProgress: (percent: number) => void }) =>
      new Promise<DownloadedTransfer>((resolve) => {
        onProgress = options.onProgress;
        finish = resolve;
      }),
  );
  return {
    progress: (percent: number) => act(() => onProgress(percent)),
    finish: (result: DownloadedTransfer) => act(async () => finish(result)),
  };
}

// jsdom ne sait ni créer d'URL d'objet ni enregistrer un fichier : on espionne ce qui aurait été enregistré.
let savedAs: string[] = [];
let revoked: string[] = [];
beforeEach(() => {
  api.downloadTransfer.mockReset();
  savedAs = [];
  revoked = [];
  URL.createObjectURL = vi.fn(() => "blob:fast-share/zip");
  URL.revokeObjectURL = vi.fn((url: string) => void revoked.push(url));
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    savedAs.push(`${this.download} <- ${this.href}`);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function setup() {
  // Avec de faux minuteurs, user-event doit savoir les faire avancer (ses frappes attendent de petits délais).
  const user = userEvent.setup(vi.isFakeTimers() ? { advanceTimers: vi.advanceTimersByTime } : {});
  render(<ReceiveTab />);
  const field = screen.getByLabelText(/Saisissez le code/);
  const submit = screen.getByRole("button", { name: "Télécharger" });
  return { user, field, submit };
}

describe("ReceiveTab — saisie", () => {
  it("met le code en majuscules, retire les espaces et active le bouton à 8 caractères", async () => {
    const { user, field, submit } = setup();
    expect(submit).toBeDisabled();

    await user.type(field, "abcd 234");
    expect(field).toHaveValue("ABCD234");
    expect(submit).toBeDisabled();

    await user.type(field, "5");
    expect(field).toHaveValue("ABCD2345");
    expect(submit).toBeEnabled();
  });

  it("accepte un code collé avec des espaces, sans le tronquer", async () => {
    const { user, field, submit } = setup();
    await user.click(field);

    await user.paste(" abcd 2345 ");

    expect(field).toHaveValue("ABCD2345");
    expect(submit).toBeEnabled();
  });

  it("signale un caractère qui n'existe pas dans les codes (O au lieu de 0…)", async () => {
    const { user, field, submit } = setup();

    await user.type(field, "ABCD234O");

    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(/ni 0, ni O, ni 1, ni I, ni L/)).toBeInTheDocument();
    expect(submit).toBeDisabled();
  });
});

describe("ReceiveTab — téléchargement", () => {
  it("affiche la bulle pendant le téléchargement, puis enregistre le ZIP sous son nom", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const download = pendingDownload();
    const { user, field } = setup();
    await user.type(field, "ABCD2345");
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();

    await user.keyboard("{Enter}");
    expect(api.downloadTransfer).toHaveBeenCalledWith("ABCD2345", expect.anything());

    download.progress(55);
    expect(screen.getByRole("progressbar", { name: "Progression du téléchargement" })).toHaveAttribute(
      "aria-valuenow",
      "55",
    );

    const zip = new Blob(["PK"], { type: "application/zip" });
    await download.finish({ blob: zip, filename: "fastshare-ABCD2345.zip" });

    expect(URL.createObjectURL).toHaveBeenCalledWith(zip);
    expect(savedAs).toEqual(["fastshare-ABCD2345.zip <- blob:fast-share/zip"]);
    expect(screen.getByText("Téléchargement terminé")).toBeInTheDocument();
    expect(screen.getByText("fastshare-ABCD2345.zip")).toBeInTheDocument();
    // L'URL d'objet est libérée ensuite, pour que le navigateur rende la mémoire du ZIP.
    expect(revoked).toEqual([]);
    act(() => vi.advanceTimersByTime(1000));
    expect(revoked).toEqual(["blob:fast-share/zip"]);
  });

  it("permet de recevoir un autre transfert", async () => {
    const download = pendingDownload();
    const { user, field } = setup();
    await user.type(field, "ABCD2345{Enter}");
    await download.finish({ blob: new Blob(["PK"]), filename: "fastshare-ABCD2345.zip" });

    await user.click(screen.getByRole("button", { name: "Recevoir un autre transfert" }));

    expect(screen.getByLabelText(/Saisissez le code/)).toHaveValue("");
  });
});

describe("ReceiveTab — erreurs", () => {
  it.each([
    [404, { error: "Code inconnu : vérifiez le code saisi." }, "Code inconnu : vérifiez le code saisi."],
    [410, { error: "Ce transfert a déjà été téléchargé." }, "Ce transfert a déjà été téléchargé."],
    [410, { error: "Ce transfert a expiré." }, "Ce transfert a expiré."],
    [
      429,
      { error: "Trop de tentatives : réessayez dans 12 min." },
      "Trop de tentatives : réessayez dans 12 min.",
    ],
    // Réponse sans message du serveur (proxy, page HTML) : message dédié au statut.
    [410, undefined, "Ce transfert a expiré ou a déjà été téléchargé."],
  ])("affiche le bon message pour un %i", async (status, body, expected) => {
    api.downloadTransfer.mockRejectedValue(httpError(status, body));
    const { user, field } = setup();

    await user.type(field, "ABCD2345{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent(expected);
    // Le code reste saisi : on peut le corriger ou réessayer.
    expect(field).toHaveValue("ABCD2345");
    expect(savedAs).toEqual([]);
  });

  it("explique un serveur injoignable", async () => {
    api.downloadTransfer.mockRejectedValue(new AxiosError("Network Error", AxiosError.ERR_NETWORK));
    const { user, field } = setup();

    await user.type(field, "ABCD2345{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent("Impossible de joindre le serveur");
  });
});

describe("ReceiveTab — protections", () => {
  it("demande confirmation avant de quitter la page pendant le téléchargement, et plus après", async () => {
    const download = pendingDownload();
    const { user, field } = setup();
    const leave = () => window.dispatchEvent(new Event("beforeunload", { cancelable: true }));
    expect(leave()).toBe(true);

    await user.type(field, "ABCD2345{Enter}");
    expect(leave()).toBe(false);

    await download.finish({ blob: new Blob(["PK"]), filename: "fastshare-ABCD2345.zip" });
    expect(leave()).toBe(true);
  });
});
