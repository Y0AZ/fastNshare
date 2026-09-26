// Teste la validation de la configuration avec de faux environnements : le vrai process.env n'est jamais modifié.
import { loadEnv, required } from "../../src/config/env.js";

const MONGODB_URI = "mongodb://user:secret@localhost:27018/fastshare?authSource=admin";

// Environnement minimal valide ; chaque test en dérive une variante.
const S3_VARS = {
  S3_REGION: "us-east-1",
  S3_BUCKET: "fastshare",
  S3_ACCESS_KEY_ID: "key",
  S3_SECRET_ACCESS_KEY: "secret",
};
const VALID = { PORT: "4000", MONGODB_URI, ...S3_VARS };

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
    expect(loadEnv({ ...VALID, S3_ENDPOINT: "http://localhost:8333", S3_FORCE_PATH_STYLE: "true" })).toEqual({
      port: 4000,
      mongodbUri: MONGODB_URI,
      s3: {
        endpoint: "http://localhost:8333",
        region: "us-east-1",
        bucket: "fastshare",
        accessKeyId: "key",
        secretAccessKey: "secret",
        forcePathStyle: true,
      },
    });
  });

  it.each(["abc", "0", "70000", "40.5"])("refuse un PORT invalide (%s)", (port) => {
    expect(() => loadEnv({ ...VALID, PORT: port })).toThrow("PORT doit être un entier");
  });

  it("exige MONGODB_URI", () => {
    expect(() => loadEnv({ ...VALID, MONGODB_URI: undefined })).toThrow(
      "variable d'environnement manquante : MONGODB_URI",
    );
  });

  it.each(["mongodb+srv://user:pw@cluster.example.net/db", MONGODB_URI])("accepte %s", (uri) => {
    expect(loadEnv({ ...VALID, MONGODB_URI: uri }).mongodbUri).toBe(uri);
  });

  // Le message ne doit pas recopier l'URI : elle contient le mot de passe et finirait dans les logs.
  it("refuse une URI sans schéma mongodb, sans divulguer son contenu", () => {
    const bad = "postgres://user:topsecret@host/db";
    expect(() => loadEnv({ ...VALID, MONGODB_URI: bad })).toThrow(/doit commencer par/);
    expect(() => loadEnv({ ...VALID, MONGODB_URI: bad })).not.toThrow(/topsecret/);
  });

  it.each(Object.keys(S3_VARS))("exige %s", (name) => {
    expect(() => loadEnv({ ...VALID, [name]: "" })).toThrow(`variable d'environnement manquante : ${name}`);
  });

  // Sans endpoint, le SDK vise AWS S3 ; sans S3_FORCE_PATH_STYLE, on garde le style par défaut d'AWS.
  it("rend S3_ENDPOINT et S3_FORCE_PATH_STYLE facultatives", () => {
    const { s3 } = loadEnv(VALID);
    expect(s3.endpoint).toBeUndefined();
    expect(s3.forcePathStyle).toBe(false);
  });

  it("refuse un S3_ENDPOINT qui n'est pas une URL", () => {
    expect(() => loadEnv({ ...VALID, S3_ENDPOINT: "localhost:8333" })).toThrow(
      "S3_ENDPOINT doit être une URL",
    );
  });

  it.each(["1", "yes", "ture", "TRUE"])("refuse S3_FORCE_PATH_STYLE=%s", (value) => {
    expect(() => loadEnv({ ...VALID, S3_FORCE_PATH_STYLE: value })).toThrow('doit valoir "true" ou "false"');
  });
});
