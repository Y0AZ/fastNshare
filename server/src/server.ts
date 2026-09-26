// Point d'entrée du processus : valide la configuration, connecte MongoDB et S3, ouvre le port HTTP, gère l'arrêt.
// Jamais importé par les tests.
import mongoose from "mongoose";
import { createApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { Transfer } from "./models/transfer.model.js";
import { createStorage } from "./lib/storage.js";

// Message court et lisible plutôt qu'une pile d'appels : au démarrage, c'est un problème d'environnement, pas un bug.
function exitOnStartupError(context: string, error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Démarrage impossible (${context}) : ${message}`);
  process.exit(1);
}

let env;
try {
  env = loadEnv();
} catch (error) {
  exitOnStartupError("configuration", error);
}

// La base est prête AVANT d'ouvrir le port : on n'accepte aucune requête qu'on ne pourrait pas servir.
try {
  // 5 s au lieu des 30 s par défaut : si Mongo est arrêté, on le sait vite au lieu d'attendre en silence.
  await mongoose.connect(env.mongodbUri, { serverSelectionTimeoutMS: 5000 });
  // Crée la collection et ses index dès le démarrage, sans attendre la première requête qui utilise le modèle.
  // Échoue aussi si l'index unique est impossible (des doublons de `code` existent déjà) : mieux vaut le savoir ici.
  await Transfer.init();
} catch (error) {
  exitOnStartupError("MongoDB", error);
}
console.log("MongoDB connecté, index de la collection transfers en place");

// Même logique pour S3 : une clé invalide ou un moteur arrêté doit bloquer le démarrage, pas le premier envoi.
const storage = createStorage(env.s3);
try {
  await storage.ensureBucket();
} catch (error) {
  exitOnStartupError("S3", error);
}
console.log(`Stockage S3 prêt (bucket ${env.s3.bucket})`);

const port = env.port;
const app = createApp();

// Express 5 transmet au callback les erreurs d'écoute (ex. port déjà utilisé) au lieu de les ignorer.
const server = app.listen(port, (error) => {
  if (error) {
    console.error(`Impossible d'écouter sur le port ${port} : ${error.message}`);
    process.exit(1);
  }
  console.log(`Serveur prêt sur http://localhost:${port}`);
});

// Arrêt propre : Render envoie SIGTERM avant de remplacer une instance, Ctrl+C envoie SIGINT, tsx watch aussi.
let shuttingDown = false;

function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} reçu : arrêt en cours…`);

  // Filet de sécurité : une requête interminable (gros téléchargement) ne doit pas bloquer l'arrêt indéfiniment.
  // unref() : ce minuteur ne retient pas à lui seul le processus en vie.
  setTimeout(() => {
    console.error("Arrêt forcé : des requêtes étaient encore en cours après 10 s");
    process.exit(1);
  }, 10_000).unref();

  // Ordre volontaire : 1) refuser les nouvelles requêtes et laisser finir celles en cours,
  // 2) seulement ensuite fermer Mongo, que ces requêtes en cours peuvent encore utiliser.
  server.close(() => {
    mongoose.disconnect().then(
      () => {
        console.log("Arrêt terminé");
        process.exit(0);
      },
      (error: unknown) => {
        console.error("Erreur à la fermeture de MongoDB :", error);
        process.exit(1);
      },
    );
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
