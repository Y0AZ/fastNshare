// Teste le rate limit du téléchargement sur l'app réelle. Le code utilisé est mal formé : le contrôleur répond
// 404 sans interroger Mongo, ce qui isole le comportement du limiteur.
import request from "supertest";
import { createApp } from "../../src/app.js";
import { DOWNLOAD_RATE_LIMIT } from "../../src/configs/limits.js";
import { createMemoryStorage } from "../helpers/memory-storage.js";

const URL = "/api/transfers/INVALIDE/download";

// express-rate-limit signale par console.error un X-Forwarded-For reçu sans proxy déclaré : on le capture.
let logged: unknown[][] = [];
const originalConsoleError = console.error;
beforeEach(() => {
  logged = [];
  console.error = (...args: unknown[]) => logged.push(args);
});
afterEach(() => {
  console.error = originalConsoleError;
});

async function exhaust(agent: ReturnType<typeof request>, headers: Record<string, string> = {}) {
  for (let i = 0; i < DOWNLOAD_RATE_LIMIT; i++) {
    await agent.get(URL).set(headers).expect(404);
  }
}

describe("rate limit du téléchargement", () => {
  it(`laisse passer ${DOWNLOAD_RATE_LIMIT} requêtes puis répond 429 en JSON avec Retry-After`, async () => {
    const agent = request(createApp({ storage: createMemoryStorage() }));
    await exhaust(agent);

    const response = await agent.get(URL);

    expect(response.status).toBe(429);
    expect(response.body).toEqual({ error: "Trop de tentatives : réessayez dans 15 min." });
    expect(Number(response.headers["retry-after"])).toBeGreaterThan(0);
    expect(response.headers["ratelimit-policy"]).toContain(`q=${DOWNLOAD_RATE_LIMIT}`);
  });

  it("annonce le quota restant sur chaque réponse (en-tête RateLimit standard)", async () => {
    const response = await request(createApp({ storage: createMemoryStorage() })).get(URL);

    expect(response.headers["ratelimit"]).toContain(`r=${DOWNLOAD_RATE_LIMIT - 1}`);
  });

  it("ne limite pas les autres routes", async () => {
    const agent = request(createApp({ storage: createMemoryStorage() }));
    await exhaust(agent);
    await agent.get(URL).expect(429);

    await agent.get("/health").expect(200);
  });

  // Derrière un proxy (Render), toutes les connexions viennent du proxy : seule l'IP lue dans X-Forwarded-For
  // distingue les clients. Sans trust proxy, ils partageraient tous le même compteur.
  it("compte par IP client derrière un proxy de confiance (TRUST_PROXY=1)", async () => {
    const agent = request(createApp({ storage: createMemoryStorage(), trustProxy: 1 }));
    await exhaust(agent, { "X-Forwarded-For": "203.0.113.1" });

    await agent.get(URL).set("X-Forwarded-For", "203.0.113.1").expect(429);
    await agent.get(URL).set("X-Forwarded-For", "203.0.113.2").expect(404);
  });

  // Sans proxy déclaré, X-Forwarded-For est un en-tête comme un autre, écrit par le client : changer sa valeur
  // à chaque requête ne doit pas remettre le compteur à zéro.
  it("ignore X-Forwarded-For sans proxy déclaré : impossible de changer d'IP en le falsifiant", async () => {
    const agent = request(createApp({ storage: createMemoryStorage() }));
    for (let i = 0; i < DOWNLOAD_RATE_LIMIT; i++) {
      await agent.get(URL).set("X-Forwarded-For", `198.51.100.${i}`).expect(404);
    }

    await agent.get(URL).set("X-Forwarded-For", "198.51.100.250").expect(429);
    expect(String(logged[0]?.[0])).toContain("ERR_ERL_UNEXPECTED_X_FORWARDED_FOR");
  });
});
