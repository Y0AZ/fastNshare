// Teste la route GET /health via Supertest, sans ouvrir de port réseau.
import request from "supertest";
import { createApp } from "../../src/app.js";

describe("GET /health", () => {
  // Supertest démarre l'app sur un port éphémère interne, d'où l'intérêt d'avoir séparé app.ts de server.ts.
  it("répond 200 avec { status: 'ok' } en JSON", async () => {
    const response = await request(createApp()).get("/health");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/application\/json/);
    expect(response.body).toEqual({ status: "ok" });
  });

  it("ne révèle pas le framework dans les en-têtes", async () => {
    const response = await request(createApp()).get("/health");

    expect(response.headers["x-powered-by"]).toBeUndefined();
  });
});
