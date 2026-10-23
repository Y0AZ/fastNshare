// Teste la route POST /api/maintenance/cleanup : montage conditionnel, contrôle du jeton, réponse du job.
import request from "supertest";
import { createApp } from "../../src/app.js";
import { MAINTENANCE_TOKEN_HEADER, tokensMatch } from "../../src/middlewares/maintenance-token.js";
import { Transfer } from "../../src/models/transfer.model.js";
import { createMemoryStorage } from "../helpers/memory-storage.js";

const TOKEN = "0123456789abcdef0123456789abcdef0123456789abcdef";
const URL = "/api/maintenance/cleanup";

// Aucun transfert expiré : le job tourne pour de vrai, mais sur une collection vide (pas de Mongo en tests unitaires).
const originalFind = Transfer.find;
let findCalls = 0;
beforeEach(() => {
  findCalls = 0;
  (Transfer as unknown as Record<string, unknown>).find = async () => {
    findCalls++;
    return [];
  };
});
afterEach(() => {
  Transfer.find = originalFind;
});

const app = () => createApp({ storage: createMemoryStorage(), maintenanceToken: TOKEN });

describe("POST /api/maintenance/cleanup", () => {
  it("lance le nettoyage avec le bon jeton et renvoie le bilan", async () => {
    const response = await request(app()).post(URL).set(MAINTENANCE_TOKEN_HEADER, TOKEN);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ transfers: 0, objects: 0, objectErrors: 0 });
    expect(findCalls).toBe(1);
  });

  it.each([
    ["absent", undefined],
    ["faux, de même longueur", TOKEN.replace(/.$/, "0")],
    ["plus court", TOKEN.slice(0, 10)],
    ["vide", ""],
  ])("répond 403 si le jeton est %s, sans lancer le nettoyage", async (_label, token) => {
    const req = request(app()).post(URL);
    const response = await (token === undefined ? req : req.set(MAINTENANCE_TOKEN_HEADER, token));

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: "Jeton de maintenance invalide." });
    expect(findCalls).toBe(0);
  });

  it("n'existe pas (404) quand aucun jeton n'est configuré", async () => {
    const response = await request(createApp({ storage: createMemoryStorage() }))
      .post(URL)
      .set(MAINTENANCE_TOKEN_HEADER, TOKEN);

    expect(response.status).toBe(404);
  });

  it("refuse GET (404) : une opération qui supprime des données passe par POST", async () => {
    const response = await request(app()).get(URL).set(MAINTENANCE_TOKEN_HEADER, TOKEN);

    expect(response.status).toBe(404);
  });
});

describe("tokensMatch", () => {
  it("compare deux jetons, quelle que soit leur longueur", () => {
    expect(tokensMatch(TOKEN, TOKEN)).toBe(true);
    expect(tokensMatch(TOKEN.toUpperCase(), TOKEN)).toBe(false);
    expect(tokensMatch("court", TOKEN)).toBe(false);
  });
});
