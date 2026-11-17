// Teste la coquille de l'application : titre, onglets accessibles (souris et clavier), rappel des règles.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import App from "./App";

// Au chargement, l'app réveille le serveur (T4.7) : simulé ici, pour qu'aucun test ne parte sur le réseau.
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  wakeServer: vi.fn(async () => {}),
}));

// Recherche par rôle accessible plutôt que par classe CSS : on teste ce que voit (ou entend) l'utilisateur.
describe("App", () => {
  it("affiche le nom du produit en titre principal", () => {
    render(<App />);

    expect(screen.getByRole("heading", { level: 1, name: "Fast&Share" })).toBeInTheDocument();
  });

  it("propose deux onglets, « Envoyer » sélectionné par défaut", () => {
    render(<App />);

    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Envoyer" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Recevoir" })).toHaveAttribute("aria-selected", "false");
    // Seul le panneau actif est exposé : l'autre est monté mais masqué.
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Glissez vos fichiers ici");
  });

  it("change d'onglet au clic", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("tab", { name: "Recevoir" }));

    expect(screen.getByRole("tab", { name: "Recevoir" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Saisissez le code de 8 caractères");
  });

  // Navigation clavier attendue d'une liste d'onglets : Tab entre dans la liste, les flèches passent d'un onglet
  // à l'autre (et bouclent), sans détour par la souris.
  it("se pilote au clavier : Tab pour entrer, flèches pour changer d'onglet", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.tab();
    expect(screen.getByRole("tab", { name: "Envoyer" })).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Recevoir" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Recevoir" })).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Envoyer" })).toHaveAttribute("aria-selected", "true");
  });

  // Les deux panneaux restent dans le DOM : changer d'onglet ne doit pas effacer un envoi en cours (T4.5).
  it("garde les deux onglets montés", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("tab", { name: "Recevoir" }));

    expect(screen.getByText(/Glissez vos fichiers ici/)).toBeInTheDocument();
  });

  it("rappelle les règles d'expiration et de téléchargement unique", () => {
    render(<App />);

    expect(screen.getByRole("contentinfo")).toHaveTextContent(
      "Les transferts expirent après 7 jours et ne sont téléchargeables qu'une fois.",
    );
  });
});
