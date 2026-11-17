// Teste le parcours d'envoi complet, tel que le vit l'utilisateur : choisir, retirer, envoyer (progression puis
// finalisation), obtenir et copier le code, et les erreurs. L'API est simulée ; readApiError reste le vrai.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from "axios";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Toaster } from "@/components/ui/sonner";
import type { CreatedTransfer } from "@/lib/api";
import { SendTab } from "./SendTab";

const api = vi.hoisted(() => ({ createTransfer: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  createTransfer: api.createTransfer,
}));

// Envoi « en attente » : le test fait avancer la progression puis répond quand il le décide.
function pendingUpload() {
  let onProgress: (percent: number) => void = () => {};
  let finish: (result: CreatedTransfer) => void = () => {};
  let fail: (error: unknown) => void = () => {};
  api.createTransfer.mockImplementation(
    (_files: File[], options: { onProgress: (percent: number) => void }) =>
      new Promise<CreatedTransfer>((resolve, reject) => {
        onProgress = options.onProgress;
        finish = resolve;
        fail = reject;
      }),
  );
  return {
    progress: (percent: number) => act(() => onProgress(percent)),
    finish: (result: CreatedTransfer) => act(async () => finish(result)),
    fail: (error: unknown) => act(async () => fail(error)),
  };
}

function httpError(status: number, message: string) {
  const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig;
  return new AxiosError(
    "échec",
    "ERR_BAD_REQUEST",
    config,
    {},
    {
      status,
      statusText: "",
      headers: {},
      config,
      data: { error: message },
    },
  );
}

const file = (name: string, content = "contenu") => new File([content], name, { lastModified: 1 });

function setup() {
  const user = userEvent.setup();
  render(
    <>
      <SendTab />
      <Toaster />
    </>,
  );
  const choose = (...files: File[]) => user.upload(screen.getByLabelText("Choisir des fichiers"), files);
  return { user, choose };
}

beforeEach(() => {
  api.createTransfer.mockReset();
});
// Les notifications sonner vivent dans un état global au module : sans ce ménage, celle d'un test
// (« Code copié… ») serait encore affichée dans le suivant.
afterEach(() => {
  toast.dismiss();
});

describe("SendTab — sélection", () => {
  it("liste les fichiers choisis avec leur taille et le total", async () => {
    const { choose } = setup();

    await choose(file("a.txt", "12345"), file("photo.png", "1234567890"));

    const list = screen.getByRole("list", { name: "Fichiers sélectionnés" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([expect.stringContaining("a.txt"), expect.stringContaining("photo.png")]);
    expect(screen.getByText(/2 fichiers · 15.o/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Envoyer/ })).toBeEnabled();
  });

  it("retire un fichier, et revient à l'état initial quand il n'en reste aucun", async () => {
    const { user, choose } = setup();
    await choose(file("a.txt"));

    await user.click(screen.getByRole("button", { name: "Retirer a.txt" }));

    expect(screen.queryByRole("list", { name: "Fichiers sélectionnés" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Envoyer/ })).not.toBeInTheDocument();
  });

  it("refuse d'envoyer une sélection hors limites, avec la raison", async () => {
    const { choose } = setup();

    await choose(...Array.from({ length: 21 }, (_, i) => file(`f${i}.txt`)));

    expect(screen.getByRole("alert")).toHaveTextContent("Trop de fichiers : 20 au maximum par transfert");
    expect(screen.getByRole("button", { name: /Envoyer/ })).toBeDisabled();
  });

  it("accepte les fichiers glissés-déposés et signale un dossier", async () => {
    setup();
    const dropped = file("depose.txt");
    const items = [
      { kind: "file", getAsFile: () => dropped, webkitGetAsEntry: () => ({ isDirectory: false }) },
      { kind: "file", getAsFile: () => null, webkitGetAsEntry: () => ({ isDirectory: true }) },
    ];

    fireEvent.drop(screen.getByRole("group", { name: "Zone de dépôt des fichiers" }), {
      dataTransfer: { items, files: [dropped] },
    });

    expect(await screen.findByText("depose.txt")).toBeInTheDocument();
    expect(await screen.findByText(/Les dossiers ne peuvent pas être envoyés/)).toBeInTheDocument();
  });
});

describe("SendTab — envoi", () => {
  it("affiche la bulle pendant l'envoi seulement, puis « Finalisation… », puis le code", async () => {
    const upload = pendingUpload();
    const { user, choose } = setup();
    await choose(file("a.txt"), file("b.txt"));
    // Avant l'envoi : pas de bulle.
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Envoyer/ }));
    expect(api.createTransfer).toHaveBeenCalledWith([expect.any(File), expect.any(File)], expect.anything());

    upload.progress(37);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "37");
    expect(screen.getByText("Envoi de 2 fichiers…")).toBeInTheDocument();

    upload.progress(100);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuetext", "Finalisation…");

    await upload.finish({ code: "ABCD2345", expiresAt: "2026-12-01T12:00:00.000Z" });
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Code du transfert")).toHaveTextContent("ABCD2345");
    expect(screen.getByText(/Valable jusqu'au 1 décembre 2026/)).toBeInTheDocument();
  });

  it("copie le code dans le presse-papiers, avec un retour visuel", async () => {
    const upload = pendingUpload();
    const { user, choose } = setup();
    await choose(file("a.txt"));
    await user.click(screen.getByRole("button", { name: /Envoyer/ }));
    await upload.finish({ code: "ABCD2345", expiresAt: "2026-12-01T12:00:00.000Z" });

    await user.click(screen.getByRole("button", { name: "Copier le code" }));

    // userEvent remplace le presse-papiers par une version simulée qu'on peut relire.
    expect(await navigator.clipboard.readText()).toBe("ABCD2345");
    expect(screen.getByRole("button", { name: "Copié" })).toBeInTheDocument();
    expect(await screen.findByText("Code copié dans le presse-papiers")).toBeInTheDocument();
  });

  it("repart d'une sélection vide avec « Nouvel envoi »", async () => {
    const upload = pendingUpload();
    const { user, choose } = setup();
    await choose(file("a.txt"));
    await user.click(screen.getByRole("button", { name: /Envoyer/ }));
    await upload.finish({ code: "ABCD2345", expiresAt: "2026-12-01T12:00:00.000Z" });

    await user.click(screen.getByRole("button", { name: "Nouvel envoi" }));

    expect(screen.getByText("Glissez vos fichiers ici, ou")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Fichiers sélectionnés" })).not.toBeInTheDocument();
  });
});

describe("SendTab — erreurs", () => {
  it.each([
    [413, "Le fichier « a.txt » dépasse la taille maximale de 200 Mo."],
    [400, "Trop de fichiers : 20 au maximum par transfert."],
  ])(
    "affiche le message du serveur pour un %i et garde les fichiers pour réessayer",
    async (status, message) => {
      const upload = pendingUpload();
      const { user, choose } = setup();
      await choose(file("a.txt"));
      await user.click(screen.getByRole("button", { name: /Envoyer/ }));

      await upload.fail(httpError(status, message));

      expect(screen.getByRole("alert")).toHaveTextContent(message);
      expect(screen.getByText("a.txt")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Réessayer l'envoi" })).toBeEnabled();
    },
  );

  it("explique un échec réseau (serveur injoignable)", async () => {
    const upload = pendingUpload();
    const { user, choose } = setup();
    await choose(file("a.txt"));
    await user.click(screen.getByRole("button", { name: /Envoyer/ }));

    await upload.fail(new AxiosError("Network Error", AxiosError.ERR_NETWORK));

    expect(screen.getByRole("alert")).toHaveTextContent("Impossible de joindre le serveur");
  });
});

describe("SendTab — préparation des fichiers par le navigateur", () => {
  // Choisir une application (.app) : le navigateur la compresse avant de la remettre, parfois pendant 10 s.
  it("indique la préparation après la fermeture du sélecteur, puis liste les fichiers à leur arrivée", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<SendTab />);
    const input = screen.getByLabelText<HTMLInputElement>("Choisir des fichiers");

    await user.click(screen.getByRole("button", { name: "Choisir des fichiers" }));
    act(() => void window.dispatchEvent(new Event("focus")));
    act(() => void vi.advanceTimersByTime(300));

    expect(screen.getByRole("status")).toHaveTextContent("Préparation des fichiers en cours…");
    expect(screen.getByText(/compresse les applications/)).toBeInTheDocument();
    // Le bouton est masqué pendant la préparation : pas de second sélecteur par-dessus.
    expect(screen.queryByRole("button", { name: "Choisir des fichiers" })).not.toBeInTheDocument();

    fireEvent.change(input, { target: { files: [file("Structured.app.zip")] } });

    expect(screen.queryByText(/compresse les applications/)).not.toBeInTheDocument();
    expect(screen.getByText("Structured.app.zip")).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("retire l'indication si le sélecteur est annulé", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<SendTab />);

    await user.click(screen.getByRole("button", { name: "Choisir des fichiers" }));
    act(() => void window.dispatchEvent(new Event("focus")));
    act(() => void vi.advanceTimersByTime(300));
    expect(screen.getByText(/compresse les applications/)).toBeInTheDocument();

    fireEvent(screen.getByLabelText("Choisir des fichiers"), new Event("cancel"));

    expect(screen.queryByText(/compresse les applications/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choisir des fichiers" })).toBeInTheDocument();
    vi.useRealTimers();
  });
});

describe("SendTab — protections", () => {
  it("refuse un fichier plus gros que 200 Mo, en le nommant", async () => {
    const { choose } = setup();
    const huge = file("film.mp4");
    // Taille simulée : inutile d'allouer 200 Mo pour tester la limite.
    Object.defineProperty(huge, "size", { value: 201 * 1024 * 1024 });

    await choose(huge);

    expect(screen.getByRole("alert")).toHaveTextContent(/« film\.mp4 » dépasse la taille maximale de 200.Mo/);
    expect(screen.getByRole("button", { name: /Envoyer/ })).toBeDisabled();
  });

  // Quitter la page pendant un envoi le perdrait : le navigateur doit demander confirmation, et seulement à ce moment.
  it("demande confirmation avant de quitter la page pendant l'envoi, et plus après", async () => {
    const upload = pendingUpload();
    const { user, choose } = setup();
    const leave = () => window.dispatchEvent(new Event("beforeunload", { cancelable: true }));
    await choose(file("a.txt"));
    expect(leave()).toBe(true);

    await user.click(screen.getByRole("button", { name: /Envoyer/ }));
    // dispatchEvent renvoie false quand l'événement a été annulé (preventDefault) : le navigateur avertit.
    expect(leave()).toBe(false);

    await upload.finish({ code: "ABCD2345", expiresAt: "2026-12-01T12:00:00.000Z" });
    expect(leave()).toBe(true);
  });

  it("empêche le navigateur d'ouvrir un fichier lâché à côté de la zone de dépôt", () => {
    setup();

    const accepted = fireEvent.drop(document.body, {
      dataTransfer: { files: [file("perdu.txt")], items: [] },
    });

    // Événement annulé : le navigateur n'ouvre pas le fichier (ce qui aurait fait quitter l'application).
    expect(accepted).toBe(false);
    expect(screen.queryByText("perdu.txt")).not.toBeInTheDocument();
  });

  it("explique comment copier à la main si le presse-papiers refuse", async () => {
    const upload = pendingUpload();
    const { user, choose } = setup();
    await choose(file("a.txt"));
    await user.click(screen.getByRole("button", { name: /Envoyer/ }));
    await upload.finish({ code: "ABCD2345", expiresAt: "2026-12-01T12:00:00.000Z" });
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("contexte non sécurisé"));

    await user.click(screen.getByRole("button", { name: "Copier le code" }));

    expect(await screen.findByText(/Copie impossible : sélectionnez le code/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copier le code" })).toBeInTheDocument();
  });
});
