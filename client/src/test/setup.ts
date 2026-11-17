// Préparation commune à tous les tests Vitest, exécutée avant chaque fichier de test.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Sans les globales Vitest (option `globals` désactivée), Testing Library ne démonte pas les composants
// automatiquement entre deux tests : on le fait explicitement pour que chaque test parte d'un DOM vide.
afterEach(() => {
  cleanup();
});

// jsdom n'a pas de rendu graphique : getContext y affiche « Not implemented » à chaque appel. On lui fait
// répondre « pas de contexte », comme un navigateur sans WebGL : les composants prennent leur repli (bulle SVG).
// Affectation simple (pas vi.spyOn) : vi.restoreAllMocks() dans un test ne doit pas défaire ce réglage.
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;

// jsdom n'implémente pas matchMedia (requêtes média CSS), que sonner appelle pour son thème. Tous les navigateurs
// l'ont : on fournit une version minimale qui répond « aucune préférence ». Un test peut la remplacer
// (vi.stubGlobal) pour simuler une préférence, comme « réduire les animations ».
window.matchMedia = (query: string) =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }) as MediaQueryList;
