// Teste le bandeau de réveil du serveur avec de faux minuteurs et un appel /health simulé.
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServerWakeBanner } from "./ServerWakeBanner";

const api = vi.hoisted(() => ({ wakeServer: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  wakeServer: api.wakeServer,
}));

// Réponse de /health que le test déclenche quand il le décide.
function pendingHealth() {
  const calls: { resolve: () => void; reject: (error: Error) => void; signal?: AbortSignal }[] = [];
  api.wakeServer.mockImplementation(
    (signal?: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        calls.push({ resolve, reject, signal });
      }),
  );
  return calls;
}

// Fait avancer le temps ET laisse les promesses se résoudre.
const wait = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

beforeEach(() => {
  vi.useFakeTimers();
  api.wakeServer.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("ServerWakeBanner", () => {
  it("n'affiche rien si le serveur répond vite (déjà éveillé)", async () => {
    const calls = pendingHealth();
    render(<ServerWakeBanner />);

    await wait(500);
    await act(async () => calls[0]?.resolve());
    await wait(5000);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("affiche le bandeau si la réponse tarde plus de 3 s, et le retire à la réponse", async () => {
    const calls = pendingHealth();
    render(<ServerWakeBanner />);

    await wait(2999);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    await wait(1);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Le serveur se réveille, cela peut prendre jusqu'à une minute.",
    );

    await act(async () => calls[0]?.resolve());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  // Pendant un réveil ou un redéploiement, /health peut échouer (502, réseau) avant de répondre.
  it("réessaie toutes les 5 s après un échec, bandeau affiché, jusqu'à la réponse", async () => {
    const calls = pendingHealth();
    render(<ServerWakeBanner />);

    await act(async () => calls[0]?.reject(new Error("502")));
    await wait(3000);
    expect(screen.getByRole("status")).toHaveTextContent("se réveille");
    expect(calls).toHaveLength(1);

    await wait(2000);
    expect(calls).toHaveLength(2);

    await act(async () => calls[1]?.resolve());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("annonce un serveur injoignable après 90 s d'échecs", async () => {
    pendingHealth();
    api.wakeServer.mockRejectedValue(new Error("réseau coupé"));
    render(<ServerWakeBanner />);

    await wait(85_000);
    expect(screen.getByRole("status")).toHaveTextContent("se réveille");

    await wait(10_000);
    expect(screen.getByRole("status")).toHaveTextContent("Le serveur ne répond pas pour le moment.");
    const callsAtGiveUp = api.wakeServer.mock.calls.length;
    await wait(60_000);
    // Plus de nouvelles tentatives une fois l'abandon annoncé.
    expect(api.wakeServer.mock.calls.length).toBe(callsAtGiveUp);
  });

  it("annule la requête en cours si la page est quittée", () => {
    const calls = pendingHealth();
    const { unmount } = render(<ServerWakeBanner />);

    unmount();

    expect(calls[0]?.signal?.aborted).toBe(true);
  });
});
