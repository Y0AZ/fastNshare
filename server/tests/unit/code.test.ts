// Teste le générateur de codes : format, alphabet, unicité statistique et retry sur doublon simulé.
import { CODE_ALPHABET, CODE_LENGTH } from "../../src/configs/limits.js";
import { generateCode, generateUniqueCode, isValidCode, normalizeCode } from "../../src/libs/code.js";

// Erreur de même forme que celle renvoyée par le driver MongoDB sur un doublon d'index unique.
function duplicateKeyError(field: string) {
  return Object.assign(new Error(`E11000 duplicate key error dup key: { ${field}: ... }`), {
    code: 11000,
    keyPattern: { [field]: 1 },
  });
}

describe("alphabet", () => {
  it("contient 31 caractères distincts, sans caractère ambigu", () => {
    expect(CODE_ALPHABET).toHaveLength(31);
    expect(new Set(CODE_ALPHABET).size).toBe(31);
    expect(CODE_ALPHABET).not.toMatch(/[0O1IL]/);
  });
});

describe("generateCode()", () => {
  const codes = Array.from({ length: 10_000 }, generateCode);

  it(`produit des codes de ${CODE_LENGTH} caractères pris dans l'alphabet`, () => {
    const pattern = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);
    expect(codes.every((code) => pattern.test(code))).toBe(true);
  });

  it("ne produit jamais de caractère ambigu", () => {
    expect(codes.some((code) => /[0O1IL]/.test(code))).toBe(false);
  });

  // 10 000 tirages parmi 31^8 : la probabilité d'un doublon est d'environ 6 sur 100 000 000.
  it("ne produit aucun doublon sur 10 000 codes", () => {
    expect(new Set(codes).size).toBe(codes.length);
  });

  // Contrôle grossier d'uniformité : sur 80 000 caractères tirés, chacun des 31 doit apparaître (≈ 2 600 fois chacun).
  it("utilise tous les caractères de l'alphabet", () => {
    expect(new Set(codes.join("")).size).toBe(CODE_ALPHABET.length);
  });
});

describe("normalizeCode()", () => {
  it("retire les espaces autour et met en majuscules", () => {
    expect(normalizeCode("  abcd2345\n")).toBe("ABCD2345");
  });
});

describe("isValidCode()", () => {
  it("accepte un code généré", () => {
    expect(isValidCode(generateCode())).toBe(true);
  });

  // Trop court, trop long, caractère exclu de l'alphabet (0, O, 1, I, L), minuscules non normalisées.
  it.each(["ABCD234", "ABCD23456", "ABCD2340", "ABCDO234", "abcd2345", ""])("refuse %j", (code) => {
    expect(isValidCode(code)).toBe(false);
  });
});

// Fausse fonction d'insertion : note les codes reçus et rejoue le comportement voulu pour chacun.
function fakeInsert(behaviour: (code: string) => void = () => {}) {
  const calls: string[] = [];
  const insert = async (code: string) => {
    calls.push(code);
    behaviour(code);
    return { code };
  };
  return { insert, calls };
}

// Générateur déterministe : renvoie les codes fournis, dans l'ordre.
function sequence(...codes: string[]) {
  let index = 0;
  return () => codes[index++] ?? "ZZZZ9999";
}

describe("generateUniqueCode()", () => {
  it("insère au premier essai si le code est libre", async () => {
    const { insert, calls } = fakeInsert();

    await expect(generateUniqueCode(insert, { generate: sequence("AAAA2222") })).resolves.toEqual({
      code: "AAAA2222",
    });
    expect(calls).toEqual(["AAAA2222"]);
  });

  it("retente avec un nouveau code quand Mongo signale un doublon sur `code`", async () => {
    const { insert, calls } = fakeInsert((code) => {
      if (code === "TAKEN222") throw duplicateKeyError("code");
    });

    await expect(generateUniqueCode(insert, { generate: sequence("TAKEN222", "FREE3333") })).resolves.toEqual(
      {
        code: "FREE3333",
      },
    );
    expect(calls).toEqual(["TAKEN222", "FREE3333"]);
  });

  it("ne retente pas un doublon sur un autre champ", async () => {
    const error = duplicateKeyError("_id");
    const { insert, calls } = fakeInsert(() => {
      throw error;
    });

    await expect(generateUniqueCode(insert)).rejects.toBe(error);
    expect(calls).toHaveLength(1);
  });

  it("ne retente pas une erreur qui n'est pas un doublon", async () => {
    const error = new Error("connexion perdue");
    const { insert, calls } = fakeInsert(() => {
      throw error;
    });

    await expect(generateUniqueCode(insert)).rejects.toBe(error);
    expect(calls).toHaveLength(1);
  });

  it("abandonne après maxAttempts doublons consécutifs", async () => {
    const { insert, calls } = fakeInsert(() => {
      throw duplicateKeyError("code");
    });

    await expect(generateUniqueCode(insert, { maxAttempts: 3 })).rejects.toThrow(
      "impossible d'obtenir un code unique après 3 tentatives",
    );
    expect(calls).toHaveLength(3);
  });
});
