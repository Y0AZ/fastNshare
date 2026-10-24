// Teste les règles métier calculées : date d'expiration d'un transfert, affichage des tailles.
import {
  computeExpiresAt,
  formatMegabytes,
  MAX_FILE_SIZE_BYTES,
  TRANSFER_TTL_MS,
} from "../../src/configs/limits.js";

describe("computeExpiresAt()", () => {
  it("ajoute exactement 7 jours à l'instant de création", () => {
    expect(computeExpiresAt(new Date("2026-11-24T10:30:00.000Z"))).toEqual(
      new Date("2026-12-01T10:30:00.000Z"),
    );
  });

  // Le 25 octobre 2026, la France passe à l'heure d'hiver : ce jour-là fait 25 h. Le calcul se fait en instants
  // absolus, donc le transfert vit bien 168 h, et non « 7 jours civils » de 169 h.
  it("ne dépend pas des changements d'heure", () => {
    const createdAt = new Date("2026-10-22T12:00:00.000Z");

    const expiresAt = computeExpiresAt(createdAt);

    expect(expiresAt.getTime() - createdAt.getTime()).toBe(168 * 60 * 60 * 1000);
  });

  it("part de maintenant par défaut", () => {
    const before = Date.now();
    const expiresAt = computeExpiresAt().getTime();
    const after = Date.now();

    expect(expiresAt).toBeGreaterThanOrEqual(before + TRANSFER_TTL_MS);
    expect(expiresAt).toBeLessThanOrEqual(after + TRANSFER_TTL_MS);
  });

  it("ne modifie pas la date reçue", () => {
    const createdAt = new Date("2026-11-24T10:30:00.000Z");

    computeExpiresAt(createdAt);

    expect(createdAt.toISOString()).toBe("2026-11-24T10:30:00.000Z");
  });
});

describe("formatMegabytes()", () => {
  it("affiche les limites en Mo (1 Mo = 1024 × 1024 octets)", () => {
    expect(formatMegabytes(MAX_FILE_SIZE_BYTES)).toBe("200 Mo");
    expect(formatMegabytes(1024 * 1024)).toBe("1 Mo");
  });
});
