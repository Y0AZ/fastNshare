// Teste la gestion d'erreurs avec des routes montées par le test lui-même : aucune route de diagnostic n'est livrée.
import express from "express";
import request from "supertest";
import { createApp } from "../../src/app.js";
import { createMemoryStorage } from "../helpers/memory-storage.js";
import { errorHandler, notFoundHandler } from "../../src/middlewares/error-handler.js";
import { badRequest, gone, HttpError, notFound, payloadTooLarge } from "../../src/middlewares/http-error.js";

// Mini-app de test : mêmes middlewares de fin que l'app réelle, devant des routes qui échouent volontairement.
function buildTestApp() {
  const app = express();
  app.get("/async-crash", async () => {
    await Promise.resolve();
    throw new Error("détail interne : mot de passe = hunter2");
  });
  app.get("/http-error", async () => {
    throw notFound("Code inconnu.");
  });
  app.get("/throws-string", () => {
    throw "pas une instance d'Error";
  });
  // Erreur levée APRÈS l'envoi des en-têtes, comme un ZIP qui échoue en cours de route (T2.3).
  app.get("/fails-mid-stream", async (_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.write("début du contenu…");
    await Promise.resolve();
    throw new Error("le flux a échoué");
  });
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

// Remplace console.error le temps d'un test : la sortie reste lisible et on peut vérifier ce qui est journalisé.
let logged: unknown[][] = [];
const originalConsoleError = console.error;
beforeEach(() => {
  logged = [];
  console.error = (...args: unknown[]) => logged.push(args);
});
afterEach(() => {
  console.error = originalConsoleError;
});

describe("errorHandler", () => {
  it("transforme l'exception d'un handler async en 500 JSON, sans divulguer le détail", async () => {
    const response = await request(buildTestApp()).get("/async-crash");

    expect(response.status).toBe(500);
    expect(response.headers["content-type"]).toMatch(/application\/json/);
    expect(response.body).toEqual({ error: "Une erreur interne est survenue. Réessayez plus tard." });
    expect(JSON.stringify(response.body)).not.toContain("hunter2");
    // Le détail n'est pas perdu pour autant : il est dans les logs du serveur.
    expect(String(logged[0]?.[1])).toContain("hunter2");
  });

  // Si le rejet n'était pas intercepté, Node arrêterait le processus (unhandled rejection) et Jest avec.
  it("garde le processus en vie : une requête suivante est servie normalement", async () => {
    const app = buildTestApp();

    await request(app).get("/async-crash").expect(500);
    await request(app).get("/http-error").expect(404);
  });

  it("renvoie une HttpError avec son statut et son message", async () => {
    const response = await request(buildTestApp()).get("/http-error");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Code inconnu." });
    expect(logged).toHaveLength(0);
  });

  it("traite une valeur levée qui n'est pas une Error comme une erreur interne", async () => {
    const response = await request(buildTestApp()).get("/throws-string");

    expect(response.status).toBe(500);
    expect(response.body).toHaveProperty("error");
  });

  // Limite connue : une fois les en-têtes (statut 200) envoyés, aucun JSON n'est possible.
  // La connexion est coupée : le client voit une réponse interrompue, pas un faux succès complet.
  it("coupe la connexion si l'erreur survient après l'envoi des en-têtes", async () => {
    const app = buildTestApp();

    await expect(request(app).get("/fails-mid-stream")).rejects.toThrow();
    await request(app).get("/http-error").expect(404);
  });
});

describe("notFoundHandler", () => {
  it("répond 404 en JSON sur une route inconnue de l'app réelle", async () => {
    const response = await request(createApp({ storage: createMemoryStorage() })).get("/nimporte-quoi");

    expect(response.status).toBe(404);
    expect(response.headers["content-type"]).toMatch(/application\/json/);
    expect(response.body).toEqual({ error: "Route introuvable." });
  });
});

describe("fabriques d'HttpError", () => {
  it.each([
    [badRequest, 400],
    [notFound, 404],
    [gone, 410],
    [payloadTooLarge, 413],
  ])("%p produit une HttpError %i avec un message par défaut", (factory, status) => {
    const error = factory();

    expect(error).toBeInstanceOf(HttpError);
    expect(error.status).toBe(status);
    expect(error.message.length).toBeGreaterThan(0);
  });

  it("accepte un message personnalisé", () => {
    expect(gone("Ce transfert a expiré.").message).toBe("Ce transfert a expiré.");
  });
});
