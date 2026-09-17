// Configuration Jest des tests UNITAIRES, en ESM natif (le projet est "type": "module").
// Lancé avec NODE_OPTIONS=--experimental-vm-modules : c'est le mécanisme qui permet à Jest d'exécuter de l'ESM.

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
};
