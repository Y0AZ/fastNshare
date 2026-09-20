// Teste la validation de la configuration avec de faux environnements : le vrai process.env n'est jamais modifié.
import { loadEnv, required } from "../../src/config/env.js";

const MONGODB_URI = "mongodb://user:secret@localhost:27018/fastshare?authSource=admin";

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
  it("renvoie la configuration typée", () => {
    expect(loadEnv({ PORT: "4000", MONGODB_URI })).toEqual({ port: 4000, mongodbUri: MONGODB_URI });
  });

  it.each(["abc", "0", "70000", "40.5"])("refuse un PORT invalide (%s)", (port) => {
    expect(() => loadEnv({ PORT: port, MONGODB_URI })).toThrow("PORT doit être un entier");
  });

  it("exige MONGODB_URI", () => {
    expect(() => loadEnv({ PORT: "4000" })).toThrow("variable d'environnement manquante : MONGODB_URI");
  });

  it.each(["mongodb+srv://user:pw@cluster.example.net/db", MONGODB_URI])("accepte %s", (uri) => {
    expect(loadEnv({ PORT: "4000", MONGODB_URI: uri }).mongodbUri).toBe(uri);
  });

  // Le message ne doit pas recopier l'URI : elle contient le mot de passe et finirait dans les logs.
  it("refuse une URI sans schéma mongodb, sans divulguer son contenu", () => {
    const bad = "postgres://user:topsecret@host/db";
    expect(() => loadEnv({ PORT: "4000", MONGODB_URI: bad })).toThrow(/doit commencer par/);
    expect(() => loadEnv({ PORT: "4000", MONGODB_URI: bad })).not.toThrow(/topsecret/);
  });
});
