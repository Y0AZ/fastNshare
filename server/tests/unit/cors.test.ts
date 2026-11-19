// Teste le CORS : en-têtes accordés à l'origine autorisée seulement, en-têtes exposés, requête préalable.
// (C'est le navigateur qui applique la règle ; ici on vérifie ce que le serveur lui répond.)
import request from "supertest";
import { createApp } from "../../src/app.js";
import { createMemoryStorage } from "../helpers/memory-storage.js";

const CLIENT = "https://fastshare.example";
const app = () => createApp({ storage: createMemoryStorage(), corsOrigins: [CLIENT] });

describe("CORS", () => {
  it("autorise l'origine du client et expose Content-Disposition et Retry-After", async () => {
    const response = await request(app()).get("/health").set("Origin", CLIENT);

    expect(response.headers["access-control-allow-origin"]).toBe(CLIENT);
    expect(response.headers["access-control-expose-headers"]).toBe("Content-Disposition,Retry-After");
  });

  // La requête est quand même traitée (CORS n'est pas une protection côté serveur) : sans en-tête d'autorisation,
  // c'est le navigateur qui refusera d'en livrer la réponse à la page.
  it("n'accorde rien à une autre origine", async () => {
    const response = await request(app()).get("/health").set("Origin", "https://site-tiers.example");

    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  // Requête préalable (preflight) : le navigateur demande la permission avant certaines requêtes.
  it("répond à la requête préalable OPTIONS de l'origine autorisée", async () => {
    const response = await request(app())
      .options("/api/transfers")
      .set("Origin", CLIENT)
      .set("Access-Control-Request-Method", "POST");

    expect(response.status).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe(CLIENT);
    expect(response.headers["access-control-allow-methods"]).toContain("POST");
  });

  it("garde les erreurs JSON lisibles par le client (404 avec en-têtes CORS)", async () => {
    const response = await request(app()).get("/route-inconnue").set("Origin", CLIENT);

    expect(response.status).toBe(404);
    expect(response.headers["access-control-allow-origin"]).toBe(CLIENT);
  });

  it("n'ajoute aucun en-tête CORS quand aucune origine n'est configurée", async () => {
    const response = await request(createApp({ storage: createMemoryStorage() }))
      .get("/health")
      .set("Origin", CLIENT);

    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
