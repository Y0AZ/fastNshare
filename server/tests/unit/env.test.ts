// Teste la validation de la configuration avec de faux environnements : le vrai process.env n'est jamais modifié.
import { loadEnv, required } from "../../src/config/env.js";

describe("required()", () => {
  it("renvoie la valeur sans espaces autour", () => {
    expect(required({ PORT: " 4000 " }, "PORT")).toBe("4000");
  });

  it("échoue avec un message qui nomme la variable manquante", () => {
    expect(() => required({}, "PORT")).toThrow("variable d'environnement manquante : PORT");
  });

  // Cas réel : une ligne `PORT=` oubliée dans .env donne une chaîne vide, pas undefined.
  it("considère une valeur vide comme manquante", () => {
    expect(() => required({ PORT: "   " }, "PORT")).toThrow("PORT");
  });
});

describe("loadEnv()", () => {
  it("convertit PORT en nombre", () => {
    expect(loadEnv({ PORT: "4000" })).toEqual({ port: 4000 });
  });

  it.each(["abc", "0", "70000", "40.5"])("refuse un PORT invalide (%s)", (port) => {
    expect(() => loadEnv({ PORT: port })).toThrow("PORT doit être un entier");
  });
});
