// Teste le client API sans serveur : les requêtes passent par un faux « adapter » axios (la couche qui envoie
// réellement la requête), qui note ce qu'il reçoit et renvoie la réponse voulue.
import {
  AxiosError,
  AxiosHeaders,
  type AxiosAdapter,
  type AxiosProgressEvent,
  type InternalAxiosRequestConfig,
} from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  api,
  createTransfer,
  downloadTransfer,
  filenameFromContentDisposition,
  readApiError,
  toPercent,
  wakeServer,
} from "./api";

const originalAdapter = api.defaults.adapter;
afterEach(() => {
  api.defaults.adapter = originalAdapter;
});

// Faux adapter : appelle `respond` avec la configuration de la requête et renvoie une réponse 200.
function fakeAdapter(
  respond: (config: InternalAxiosRequestConfig) => { data?: unknown; headers?: Record<string, string> },
) {
  const requests: InternalAxiosRequestConfig[] = [];
  const adapter: AxiosAdapter = async (config) => {
    requests.push(config);
    const { data, headers = {} } = respond(config);
    return { data, status: 200, statusText: "OK", headers: new AxiosHeaders(headers), config };
  };
  api.defaults.adapter = adapter;
  return requests;
}

const progress = (loaded: number, total?: number) =>
  ({ loaded, total, bytes: 0, lengthComputable: total !== undefined }) as AxiosProgressEvent;

// Erreur telle qu'axios la produit après une réponse du serveur (ou sans réponse si `response` est absent).
function httpError(status: number, data: unknown) {
  const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig;
  return new AxiosError(
    "échec",
    "ERR_BAD_REQUEST",
    config,
    {},
    { status, statusText: "", headers: {}, config, data },
  );
}

describe("toPercent", () => {
  it("convertit l'avancement en pourcentage entier, plafonné à 100", () => {
    expect(toPercent(progress(50, 200))).toBe(25);
    expect(toPercent(progress(1, 3))).toBe(33);
    expect(toPercent(progress(210, 200))).toBe(100);
  });

  it("renvoie undefined quand la taille totale est inconnue", () => {
    expect(toPercent(progress(50))).toBeUndefined();
  });
});

describe("createTransfer", () => {
  it("envoie chaque fichier dans le champ « files » et renvoie { code, expiresAt }", async () => {
    const requests = fakeAdapter(() => ({
      data: { code: "ABCD2345", expiresAt: "2026-12-01T10:00:00.000Z" },
    }));
    const files = [new File(["a"], "a.txt"), new File(["bb"], "Été.png")];

    const created = await createTransfer(files);

    expect(created).toEqual({ code: "ABCD2345", expiresAt: "2026-12-01T10:00:00.000Z" });
    expect(requests[0]?.method).toBe("post");
    expect(requests[0]?.url).toBe("/api/transfers");
    const form = requests[0]?.data as FormData;
    expect(form.getAll("files").map((file) => (file as File).name)).toEqual(["a.txt", "Été.png"]);
  });

  it("transmet la progression de l'envoi en pourcentage", async () => {
    fakeAdapter((config) => {
      config.onUploadProgress?.(progress(50, 200));
      config.onUploadProgress?.(progress(200, 200));
      return { data: { code: "ABCD2345", expiresAt: "" } };
    });
    const onProgress = vi.fn();

    await createTransfer([new File(["a"], "a.txt")], { onProgress });

    expect(onProgress.mock.calls).toEqual([[25], [100]]);
  });
});

describe("downloadTransfer", () => {
  it("demande un Blob et lit le nom de fichier dans Content-Disposition", async () => {
    const zip = new Blob(["PK"], { type: "application/zip" });
    const requests = fakeAdapter(() => ({
      data: zip,
      headers: { "content-disposition": 'attachment; filename="fastshare-ABCD2345.zip"' },
    }));

    const result = await downloadTransfer("ABCD2345");

    expect(requests[0]?.url).toBe("/api/transfers/ABCD2345/download");
    expect(requests[0]?.responseType).toBe("blob");
    expect(result).toEqual({ blob: zip, filename: "fastshare-ABCD2345.zip" });
  });

  // Cas réel en production si le serveur n'expose pas l'en-tête (CORS) : le nom ne doit pas être perdu.
  it("reconstruit le nom du ZIP si l'en-tête est illisible", async () => {
    fakeAdapter(() => ({ data: new Blob(["PK"]) }));

    expect((await downloadTransfer("ABCD2345")).filename).toBe("fastshare-ABCD2345.zip");
  });
});

describe("wakeServer", () => {
  it("appelle /health", async () => {
    const requests = fakeAdapter(() => ({ data: { status: "ok" } }));

    await wakeServer();

    expect(requests[0]?.url).toBe("/health");
  });
});

describe("filenameFromContentDisposition", () => {
  it.each([
    ['attachment; filename="fastshare-ABCD2345.zip"', "fastshare-ABCD2345.zip"],
    ["attachment; filename=simple.zip", "simple.zip"],
    // La forme encodée (RFC 6266) prime : c'est elle qui porte les accents.
    ["attachment; filename=\"ete.zip\"; filename*=UTF-8''%C3%89t%C3%A9.zip", "Été.zip"],
    ["attachment; filename*=UTF-8''%E0%A4%A.zip; filename=\"secours.zip\"", "secours.zip"],
    ["attachment", undefined],
    [undefined, undefined],
  ])("%j → %j", (header, expected) => {
    expect(filenameFromContentDisposition(header)).toBe(expected);
  });
});

describe("readApiError", () => {
  it("signale un serveur injoignable (aucune réponse : hors ligne, serveur arrêté, CORS)", async () => {
    const error = new AxiosError("Network Error", AxiosError.ERR_NETWORK);

    expect(await readApiError(error)).toEqual({
      kind: "network",
      message: "Impossible de joindre le serveur. Vérifiez votre connexion, puis réessayez.",
    });
  });

  it("reprend le message du serveur quand le corps est du JSON déjà décodé", async () => {
    expect(await readApiError(httpError(413, { error: "Envoi trop volumineux." }))).toEqual({
      kind: "http",
      status: 413,
      message: "Envoi trop volumineux.",
      fromServer: true,
    });
  });

  // En mode blob (téléchargement), axios livre aussi le corps d'erreur en Blob : il faut le relire.
  it("relit le message du serveur quand le corps est un Blob JSON", async () => {
    const body = new Blob([JSON.stringify({ error: "Ce transfert a expiré." })], {
      type: "application/json",
    });

    expect(await readApiError(httpError(410, body))).toEqual({
      kind: "http",
      status: 410,
      message: "Ce transfert a expiré.",
      fromServer: true,
    });
  });

  it("relit le message quand le corps est du JSON resté en texte", async () => {
    expect((await readApiError(httpError(404, '{"error":"Code inconnu."}'))).message).toBe("Code inconnu.");
  });

  // Page HTML d'un proxy ou d'un hébergeur en panne : pas de champ « error », message générique avec le statut.
  it.each([
    ["un Blob HTML", new Blob(["<html>Bad Gateway</html>"], { type: "text/html" })],
    ["un texte non JSON", "Bad Gateway"],
    ["un objet sans champ error", { message: "autre format" }],
    ["un corps vide", undefined],
  ])("donne un message générique avec le statut pour %s", async (_label, body) => {
    expect(await readApiError(httpError(502, body))).toEqual({
      kind: "http",
      status: 502,
      message: "Le serveur a répondu par une erreur inattendue (HTTP 502).",
      fromServer: false,
    });
  });

  it("distingue une annulation volontaire, à ne pas afficher comme une erreur", async () => {
    const controller = new AbortController();
    fakeAdapter(() => ({}));
    controller.abort();

    const error = await wakeServer(controller.signal).catch((e: unknown) => e);

    expect((await readApiError(error)).kind).toBe("canceled");
  });

  it("donne un message générique pour une erreur qui ne vient pas d'axios", async () => {
    expect(await readApiError(new TypeError("bug"))).toEqual({
      kind: "unknown",
      message: "Une erreur inattendue est survenue.",
    });
  });
});
