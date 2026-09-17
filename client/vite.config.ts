// Configuration Vite (serveur de dev, build) et Vitest (tests), réunies : les tests voient les mêmes plugins et alias.
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Alias @ → src/ pour Vite. TypeScript a son propre équivalent (`paths` dans les tsconfig) :
    // il faut les deux, l'un pour compiler, l'autre pour que l'éditeur et `tsc` résolvent les mêmes imports.
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    // jsdom simule un navigateur (document, window) dans Node : React peut y rendre des composants.
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
});
