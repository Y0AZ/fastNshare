// Point d'entrée du processus : valide la configuration puis ouvre le port HTTP. Jamais importé par les tests.
import { createApp } from "./app.js";
import { loadEnv, type Env } from "./config/env.js";

function readEnvOrExit(): Env {
  try {
    return loadEnv();
  } catch (error) {
    // Message court et lisible plutôt qu'une pile d'appels : c'est une erreur de configuration, pas un bug.
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Démarrage impossible : ${message}`);
    process.exit(1);
  }
}

const env = readEnvOrExit();
const app = createApp();

// Express 5 transmet au callback les erreurs d'écoute (ex. port déjà utilisé) au lieu de les ignorer.
app.listen(env.port, (error) => {
  if (error) {
    console.error(`Impossible d'écouter sur le port ${env.port} : ${error.message}`);
    process.exit(1);
  }
  console.log(`Serveur prêt sur http://localhost:${env.port}`);
});
