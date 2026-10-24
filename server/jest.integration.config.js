// Configuration Jest des tests d'INTÉGRATION : même base que les tests unitaires, mais contre de vraies
// dépendances (Mongo et S3 démarrés par Testcontainers), d'où un dossier, un délai et une exécution à part.
import base from "./jest.config.js";

/** @type {import("jest").Config} */
export default {
  ...base,
  testMatch: ["<rootDir>/tests/integration/**/*.test.ts"],
  // Conteneurs démarrés une fois pour toute la suite, arrêtés à la fin : quelques secondes au lieu de les
  // relancer pour chaque fichier. Chaque fichier y isole ses données (sa base, son bucket).
  globalSetup: "<rootDir>/tests/integration/global-setup.ts",
  globalTeardown: "<rootDir>/tests/integration/global-teardown.ts",
  // Le premier démarrage d'un conteneur peut télécharger son image : 5 s (défaut) ne suffisent pas.
  testTimeout: 60_000,
};
