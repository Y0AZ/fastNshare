// Configuration ESLint (format « flat config ») : règles de qualité du code. La mise en forme est laissée à Prettier.
import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  // Fichiers générés : jamais analysés.
  { ignores: ["dist/", "coverage/"] },

  // Règles recommandées JavaScript puis TypeScript. Aucune n'est stylistique : pas de conflit avec Prettier.
  js.configs.recommended,
  tseslint.configs.recommended,

  {
    languageOptions: {
      // Code exécuté par Node : `process`, `console`, etc. sont des globales connues.
      globals: globals.node,
    },
    rules: {
      // Un paramètre préfixé par _ est volontairement inutilisé (ex. `_req` dans un handler Express).
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
);
