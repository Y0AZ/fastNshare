// Lit et valide les variables d'environnement : le serveur refuse de démarrer si la configuration est incomplète.
import dotenv from "dotenv";
import type { StorageConfig } from "../libs/storage.js";

// Charge server/.env s'il existe. En production (Render), les variables viennent de l'hébergeur et ce fichier
// est absent : dotenv ne fait alors rien. `quiet` évite le message publicitaire que dotenv affiche par défaut.
dotenv.config({ quiet: true });

export type Env = {
  port: number;
  mongodbUri: string;
  s3: StorageConfig;
  trustProxy: number;
  // Absent → la route de maintenance n'est pas montée du tout.
  maintenanceToken?: string;
  // Origines (navigateurs) autorisées à appeler l'API ; vide → CORS désactivé.
  corsOrigins: string[];
};

type EnvSource = Record<string, string | undefined>;

// Une chaîne vide compte comme absente : une ligne `PORT=` dans .env ne doit pas passer la validation.
export function required(source: EnvSource, name: string): string {
  const value = source[name]?.trim();
  if (!value) {
    throw new Error(`variable d'environnement manquante : ${name} (voir server/.env.example)`);
  }
  return value;
}

function parsePort(raw: string): number {
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT doit être un entier entre 1 et 65535 (reçu : "${raw}")`);
  }
  return port;
}

// Vérifie seulement le schéma de l'URI : le message d'erreur ne doit jamais recopier l'URI, qui contient le mot de passe.
function parseMongoUri(raw: string): string {
  if (!/^mongodb(\+srv)?:\/\//.test(raw)) {
    throw new Error('MONGODB_URI doit commencer par "mongodb://" ou "mongodb+srv://"');
  }
  return raw;
}

// Variable facultative : absente ou vide → undefined.
function optional(source: EnvSource, name: string): string | undefined {
  return source[name]?.trim() || undefined;
}

// Seules les valeurs exactes « true » et « false » sont acceptées : une faute de frappe (« ture ») doit
// échouer au démarrage plutôt que de valoir false en silence.
function parseBoolean(name: string, raw: string | undefined, defaultValue: boolean): boolean {
  if (raw === undefined) return defaultValue;
  if (raw === "true" || raw === "false") return raw === "true";
  throw new Error(`${name} doit valoir "true" ou "false" (reçu : "${raw}")`);
}

// Le protocole est vérifié explicitement : « localhost:8333 » est une URL valide pour le parseur
// (protocole « localhost: »), mais inutilisable comme endpoint HTTP.
function parseUrl(name: string, raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const protocol = URL.canParse(raw) ? new URL(raw).protocol : "";
  if (protocol !== "http:" && protocol !== "https:") {
    throw new Error(`${name} doit être une URL http(s) complète, ex. http://localhost:8333`);
  }
  return raw;
}

// Nombre de proxys de confiance devant le serveur (1 derrière Render), et non « true » : avec true, Express
// croirait l'IP la plus à gauche de X-Forwarded-For, que n'importe quel client peut écrire lui-même pour
// changer d'identité à chaque requête et contourner le rate limit. Absent → 0 : aucun proxy, IP de la connexion.
function parseTrustProxy(raw: string | undefined): number {
  if (raw === undefined) return 0;
  const hops = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(hops)) {
    throw new Error(`TRUST_PROXY doit être un nombre de proxys, entier positif ou nul (reçu : "${raw}")`);
  }
  return hops;
}

// Jeton facultatif, mais s'il est défini il doit être long : il protège une route qui supprime des données.
// 32 caractères minimum, soit l'ordre de grandeur de `openssl rand -hex 32` (64 caractères aléatoires).
const MIN_MAINTENANCE_TOKEN_LENGTH = 32;
function parseMaintenanceToken(raw: string | undefined): string | undefined {
  if (raw !== undefined && raw.length < MIN_MAINTENANCE_TOKEN_LENGTH) {
    throw new Error(
      `MAINTENANCE_TOKEN doit faire au moins ${MIN_MAINTENANCE_TOKEN_LENGTH} caractères (générer : openssl rand -hex 32)`,
    );
  }
  return raw;
}

// Liste séparée par des virgules (ex. l'URL Vercel, plus localhost:5173 en développement). Chaque entrée est
// ramenée à son ORIGINE (protocole + hôte + port) : le navigateur envoie « https://x.vercel.app » sans « / »
// final, et une URL recopiée avec un « / » ou un chemin ne correspondrait jamais, bloquant le client en silence.
function parseCorsOrigins(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
    .map((entry) => {
      const url = URL.canParse(entry) ? new URL(entry) : undefined;
      if (
        !url ||
        (url.protocol !== "http:" && url.protocol !== "https:") ||
        (url.pathname !== "/" && url.pathname !== "")
      ) {
        throw new Error(
          `CORS_ORIGIN : "${entry}" n'est pas une origine valide (ex. https://fastshare.vercel.app)`,
        );
      }
      return url.origin;
    });
}

// La source est injectable pour que les tests vérifient la validation sans modifier le vrai process.env.
export function loadEnv(source: EnvSource = process.env): Env {
  return {
    port: parsePort(required(source, "PORT")),
    mongodbUri: parseMongoUri(required(source, "MONGODB_URI")),
    s3: {
      // Absente pour AWS S3 ; obligatoire en pratique pour SeaweedFS, R2 ou B2.
      endpoint: parseUrl("S3_ENDPOINT", optional(source, "S3_ENDPOINT")),
      region: required(source, "S3_REGION"),
      bucket: required(source, "S3_BUCKET"),
      accessKeyId: required(source, "S3_ACCESS_KEY_ID"),
      secretAccessKey: required(source, "S3_SECRET_ACCESS_KEY"),
      forcePathStyle: parseBoolean("S3_FORCE_PATH_STYLE", optional(source, "S3_FORCE_PATH_STYLE"), false),
    },
    trustProxy: parseTrustProxy(optional(source, "TRUST_PROXY")),
    maintenanceToken: parseMaintenanceToken(optional(source, "MAINTENANCE_TOKEN")),
    corsOrigins: parseCorsOrigins(optional(source, "CORS_ORIGIN")),
  };
}
