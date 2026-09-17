// Configuration ESLint du client (base fournie par le gabarit Vite) : règles de qualité, la mise en forme reste à Prettier.
import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores(["dist", "coverage"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      // Vérifie les règles des hooks React (appels conditionnels, dépendances des effets).
      reactHooks.configs.flat.recommended,
      // Signale les fichiers qui empêchent le rechargement à chaud de Vite de garder l'état des composants.
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    // Les composants shadcn exportent aussi leurs variantes (ex. buttonVariants) à côté du composant.
    // On tolère ce cas ici plutôt que de modifier du code généré, qu'un `shadcn add --overwrite` réécrirait.
    files: ["src/components/ui/**/*.tsx"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
]);
