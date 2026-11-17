// Teste la bulle de progression : valeur bornée, sémantique ARIA (ce qu'entend un lecteur d'écran), finalisation,
// et choix du rendu (boule WebGL ou repli SVG).
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetWebGL2SupportCache } from "@/lib/graphics";
import { clampPercent, FINALIZING_LABEL, formatPercent } from "@/lib/progress";
import { ProgressBubble } from "./ProgressBubble";

// jsdom n'exécute pas WebGL : la vraie boule est remplacée par un double qui expose les props reçues.
vi.mock("@/components/react-bits/CrystalizedBall", () => ({
  default: (props: { fill: number; preset: string }) => (
    <div data-testid="boule" data-fill={props.fill} data-preset={props.preset} />
  ),
}));

// Simule (ou non) un navigateur capable de WebGL2. Par défaut : non, comme jsdom, mais sans son message d'erreur.
function simulateWebGL2(available: boolean) {
  resetWebGL2SupportCache();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    (available ? { getExtension: () => null } : null) as unknown as RenderingContext,
  );
}

// Simule la préférence « réduire les animations », avec la possibilité de la changer en direct.
function simulateReducedMotion(initial: boolean) {
  let matches = initial;
  const listeners = new Set<() => void>();
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() {
      return query.includes("reduce") && matches;
    },
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  }));
  return (next: boolean) => {
    matches = next;
    for (const listener of listeners) listener();
  };
}

beforeEach(() => {
  simulateWebGL2(false);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// Testing Library remplace par défaut toute suite d'espaces par une espace ordinaire, l'insécable comprise :
// on désactive cette normalisation pour vérifier le texte exact affiché.
const exactly = { normalizer: (text: string) => text };

describe("formatPercent", () => {
  // Espace insécable (U+00A0) entre le nombre et « % » : jamais de retour à la ligne entre les deux.
  it("sépare le nombre et « % » par une espace insécable", () => {
    expect(formatPercent(50)).toBe("50" + String.fromCharCode(0xa0) + "%");
  });
});

describe("clampPercent", () => {
  it.each([
    [0, 0],
    [50, 50],
    [100, 100],
    [-20, 0],
    [150, 100],
    [33.6, 34],
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 100],
  ])("%p → %p", (value, expected) => {
    expect(clampPercent(value)).toBe(expected);
  });
});

describe("ProgressBubble", () => {
  it.each([0, 50, 100])("expose une barre de progression à %i %%", (value) => {
    render(<ProgressBubble value={value} />);

    const bar = screen.getByRole("progressbar", { name: "Progression de l'envoi" });
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
    expect(bar).toHaveAttribute("aria-valuenow", String(value));
    expect(bar).toHaveAttribute("aria-valuetext", formatPercent(value));
  });

  it("borne la valeur reçue, dans les attributs comme à l'écran", () => {
    render(<ProgressBubble value={180} />);

    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    expect(screen.getAllByText(formatPercent(100), exactly)).toHaveLength(2);
  });

  it("affiche le pourcentage au centre de la bulle", () => {
    render(<ProgressBubble value={42} />);

    // Deux couches de texte (sombre sur le vide, claire sur le liquide), un seul nombre.
    expect(screen.getAllByText(formatPercent(42), exactly)).toHaveLength(2);
  });

  // Le navigateur a tout envoyé, le serveur termine l'écriture : la bulle est pleine et le dit.
  it("annonce « Finalisation… » pendant la finalisation", () => {
    render(<ProgressBubble value={73} finalizing />);

    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "100");
    expect(bar).toHaveAttribute("aria-valuetext", FINALIZING_LABEL);
    expect(screen.getAllByText(FINALIZING_LABEL)).toHaveLength(2);
    expect(screen.queryByText(formatPercent(73), exactly)).not.toBeInTheDocument();
  });

  it("accepte un autre nom accessible (ex. pour un téléchargement)", () => {
    render(<ProgressBubble value={10} label="Progression du téléchargement" />);

    expect(screen.getByRole("progressbar", { name: "Progression du téléchargement" })).toBeInTheDocument();
  });

  // Le dessin est décoratif : seul l'élément progressbar doit être annoncé, pas le SVG ni ses textes.
  it("masque le dessin SVG aux technologies d'assistance", () => {
    const { container } = render(<ProgressBubble value={50} />);

    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  // Deux bulles sur une page ne doivent pas partager leurs découpes SVG (identifiants en double).
  it("donne des identifiants de découpe uniques à chaque bulle", () => {
    const { container } = render(
      <>
        <ProgressBubble value={10} />
        <ProgressBubble value={90} />
      </>,
    );

    const ids = [...container.querySelectorAll("clipPath")].map((clip) => clip.id);
    expect(new Set(ids).size).toBe(6);
  });
});

describe("ProgressBubble — choix du rendu", () => {
  it("garde la bulle SVG quand WebGL2 est indisponible", () => {
    const { container } = render(<ProgressBubble value={30} />);

    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(screen.queryByTestId("boule")).not.toBeInTheDocument();
  });

  it("affiche la boule de cristal avec fill = valeur / 100 quand WebGL2 est disponible", async () => {
    simulateWebGL2(true);
    const { container } = render(<ProgressBubble value={42} />);

    const ball = await screen.findByTestId("boule");
    expect(ball).toHaveAttribute("data-fill", "0.42");
    expect(ball).toHaveAttribute("data-preset", "frost");
    expect(container.querySelector("svg")).not.toBeInTheDocument();
    // Le pourcentage reste écrit par-dessus, et la sémantique ne change pas.
    expect(screen.getByText(formatPercent(42), exactly)).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "42");
  });

  it("remplit la boule pendant la finalisation", async () => {
    simulateWebGL2(true);
    render(<ProgressBubble value={73} finalizing />);

    expect(await screen.findByTestId("boule")).toHaveAttribute("data-fill", "1");
    expect(screen.getByText(FINALIZING_LABEL)).toBeInTheDocument();
  });

  it("garde la bulle SVG si l'utilisateur demande moins d'animations, même avec WebGL2", () => {
    simulateWebGL2(true);
    simulateReducedMotion(true);
    const { container } = render(<ProgressBubble value={42} />);

    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(screen.queryByTestId("boule")).not.toBeInTheDocument();
  });

  it("bascule vers la bulle SVG si la préférence change pendant l'affichage", async () => {
    simulateWebGL2(true);
    const setReducedMotion = simulateReducedMotion(false);
    const { container } = render(<ProgressBubble value={42} />);
    await screen.findByTestId("boule");

    act(() => setReducedMotion(true));

    expect(screen.queryByTestId("boule")).not.toBeInTheDocument();
    expect(container.querySelector("svg")).toBeInTheDocument();
  });
});

describe("ProgressBubble — bulle inerte (sans valeur)", () => {
  it("affiche la boule « eclipse », décorative : ni barre de progression, ni pourcentage", async () => {
    simulateWebGL2(true);
    const { container } = render(<ProgressBubble />);

    const ball = await screen.findByTestId("boule");
    expect(ball).toHaveAttribute("data-preset", "eclipse");
    // Remplissage laissé au preset : la prop n'est pas transmise.
    expect(ball).not.toHaveAttribute("data-fill");
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  // Sans WebGL, un cercle SVG vide « 0 % » ferait croire à une opération en cours : rien n'est affiché.
  it("n'affiche rien au repos quand WebGL2 est indisponible", () => {
    const { container } = render(<ProgressBubble />);

    expect(container.querySelector("svg")).not.toBeInTheDocument();
    expect(screen.queryByTestId("boule")).not.toBeInTheDocument();
  });

  // Recréer la boule (nouvelle scène WebGL) à chaque changement d'état la ferait clignoter.
  it("garde la même boule en passant d'inerte à actif, et change seulement sa couleur", async () => {
    simulateWebGL2(true);
    const { rerender } = render(<ProgressBubble />);
    const idleBall = await screen.findByTestId("boule");

    rerender(<ProgressBubble value={30} />);

    const activeBall = screen.getByTestId("boule");
    expect(activeBall).toBe(idleBall);
    expect(activeBall).toHaveAttribute("data-preset", "frost");
    expect(activeBall).toHaveAttribute("data-fill", "0.3");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "30");
  });

  // Préparation : même couleur qu'au repos, mais la bulle « respire » (clignotement progressif de l'opacité).
  it("garde la couleur inerte et respire pendant la préparation des fichiers", async () => {
    simulateWebGL2(true);
    const { container, rerender } = render(<ProgressBubble preparing />);

    expect(await screen.findByTestId("boule")).toHaveAttribute("data-preset", "eclipse");
    expect(container.firstElementChild).toHaveClass("motion-safe:animate-pulse");
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();

    // Le clignotement s'arrête dès que la bulle mesure un vrai chargement.
    rerender(<ProgressBubble preparing value={10} />);
    expect(container.firstElementChild).not.toHaveClass("motion-safe:animate-pulse");
  });
});
