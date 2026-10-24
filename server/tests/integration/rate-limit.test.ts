// Test d'intégration du rate limit : chaque requête traverse l'app complète jusqu'au vrai Mongo.
import request from "supertest";
import { DOWNLOAD_RATE_LIMIT } from "../../src/configs/limits.js";
import { createIntegrationContext, type IntegrationContext } from "./helpers/context.js";

let ctx: IntegrationContext;

beforeAll(async () => {
  ctx = await createIntegrationContext("rate-limit");
});
afterAll(async () => {
  await ctx.close();
});

describe("rate limit du téléchargement (vrai Mongo)", () => {
  it(`répond 429 à la requête n° ${DOWNLOAD_RATE_LIMIT + 1}, avec Retry-After`, async () => {
    const agent = request(ctx.app());
    // Code bien formé mais inconnu : chaque requête interroge réellement Mongo avant de répondre 404.
    for (let i = 0; i < DOWNLOAD_RATE_LIMIT; i++) {
      await agent.get("/api/transfers/ABCDEFGH/download").expect(404);
    }

    const response = await agent.get("/api/transfers/ABCDEFGH/download");

    expect(response.status).toBe(429);
    expect(Number(response.headers["retry-after"])).toBeGreaterThan(0);
    expect(response.body).toEqual({ error: "Trop de tentatives : réessayez dans 15 min." });
  });
});
