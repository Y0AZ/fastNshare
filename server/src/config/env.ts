// Lit et valide les variables d'environnement : le serveur refuse de démarrer si la configuration est incomplète.
import dotenv from "dotenv";

// Charge server/.env s'il existe. En production (Render), les variables viennent de l'hébergeur et ce fichier
// est absent : dotenv ne fait alors rien. `quiet` évite le message publicitaire que dotenv affiche par défaut.
dotenv.config({ quiet: true });

export type Env = {
  port: number;
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

// La source est injectable pour que les tests vérifient la validation sans modifier le vrai process.env.
export function loadEnv(source: EnvSource = process.env): Env {
  return {
    port: parsePort(required(source, "PORT")),
  };
}
