// Configuration Jest des tests UNITAIRES, en ESM natif (le projet est "type": "module").
// Lancé avec NODE_OPTIONS=--experimental-vm-modules : c'est le mécanisme qui permet à Jest d'exécuter de l'ESM.
// Les tests d'intégration réutilisent cette base (jest.integration.config.js) : une seule config à maintenir.

/** @type {import("jest").Config} */
export default {
  testEnvironment: "node",
  testMatch: ["<rootDir>/tests/unit/**/*.test.ts"],

  // Sans cette ligne, Jest traiterait les .ts comme du CommonJS et refuserait les `import`.
  extensionsToTreatAsEsm: [".ts"],

  // Le code importe "./app.js" (règle NodeNext) mais le fichier sur disque est app.ts :
  // on retire le suffixe .js des imports relatifs pour que Jest retrouve le fichier source.
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },

  // SWC retire les types TypeScript sans les vérifier (rapide) : la vérification reste le rôle de `npm run typecheck`.
  // module "es6" : SWC garde les import/export tels quels, Jest les exécute en ESM.
  transform: {
    "^.+\\.ts$": [
      "@swc/jest",
      {
        jsc: { parser: { syntax: "typescript" }, target: "es2023" },
        module: { type: "es6" },
      },
    ],
  },

  // Couverture (npm run test:coverage). Moteur V8 : c'est Node qui compte les lignes exécutées. Le moteur par
  // défaut (Babel) instrumente le code au moment de la transformation, or ici c'est SWC qui transforme : il ne
  // verrait rien.
  coverageProvider: "v8",
  // Tout le code source, y compris les fichiers qu'aucun test n'importe (sinon ils seraient oubliés, pas à 0 %).
  // server.ts est exclu : c'est le point d'entrée (connexions réelles, listen, signaux), qu'on vérifie en
  // démarrant le serveur, pas en test unitaire.
  collectCoverageFrom: ["src/**/*.ts", "!src/server.ts"],
  // « text » : tableau dans le terminal ; « html » : rapport navigable dans coverage/index.html (ignoré par git).
  coverageReporters: ["text", "html"],
};
