// Préparation commune à tous les tests Vitest, exécutée avant chaque fichier de test.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Sans les globales Vitest (option `globals` désactivée), Testing Library ne démonte pas les composants
// automatiquement entre deux tests : on le fait explicitement pour que chaque test parte d'un DOM vide.
afterEach(() => {
  cleanup();
});
