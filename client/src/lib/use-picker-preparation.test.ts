// Teste la détection « sélecteur refermé, fichiers pas encore arrivés » avec de faux minuteurs.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePickerPreparation } from "./use-picker-preparation";

// Le sélecteur natif se ferme : la fenêtre retrouve le focus.
const pickerClosed = () => act(() => void window.dispatchEvent(new Event("focus")));
const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("usePickerPreparation", () => {
  it("signale la préparation si les fichiers n'arrivent pas 300 ms après la fermeture du sélecteur", () => {
    const { result } = renderHook(() => usePickerPreparation());

    act(() => result.current.start());
    pickerClosed();
    wait(299);
    expect(result.current.preparing).toBe(false);

    wait(1);
    expect(result.current.preparing).toBe(true);

    act(() => result.current.stop());
    expect(result.current.preparing).toBe(false);
  });

  // Cas courant : des fichiers ordinaires arrivent aussitôt, l'indication ne doit même pas clignoter.
  it("ne signale rien si les fichiers arrivent avant le délai", () => {
    const { result } = renderHook(() => usePickerPreparation());

    act(() => result.current.start());
    pickerClosed();
    wait(100);
    act(() => result.current.stop());
    wait(1000);

    expect(result.current.preparing).toBe(false);
  });

  it("ignore un retour de focus quand aucun sélecteur n'a été ouvert (changement d'onglet du navigateur…)", () => {
    const { result } = renderHook(() => usePickerPreparation());

    pickerClosed();
    wait(1000);

    expect(result.current.preparing).toBe(false);
  });

  it("abandonne l'indication au bout de 2 minutes si le navigateur ne signale rien", () => {
    const { result } = renderHook(() => usePickerPreparation());
    act(() => result.current.start());
    pickerClosed();
    wait(300);
    expect(result.current.preparing).toBe(true);

    wait(120_000);

    expect(result.current.preparing).toBe(false);
  });
});
