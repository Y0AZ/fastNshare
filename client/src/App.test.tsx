// Test de fumée : l'application se rend sans erreur et affiche son titre et son bouton.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("App", () => {
  // Recherche par rôle accessible plutôt que par classe CSS : on teste ce que voit l'utilisateur.
  it("affiche le titre de l'application", () => {
    render(<App />);
    expect(screen.getByRole("heading", { level: 1, name: "Fast&Share" })).toBeInTheDocument();
  });

  it("affiche un bouton shadcn", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: "Commencer" })).toBeInTheDocument();
  });
});
