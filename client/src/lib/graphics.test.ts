// Teste la détection des capacités graphiques : WebGL2 (testé une fois, contexte d'essai libéré) et préférence
// « réduire les animations » (suivie en direct).
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetWebGL2SupportCache, supportsWebGL2, usePrefersReducedMotion } from "./graphics";

beforeEach(() => {
  resetWebGL2SupportCache();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("supportsWebGL2", () => {
  it("teste une seule fois, puis rend aussitôt le contexte d'essai", () => {
    const loseContext = vi.fn();
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue({ getExtension: () => ({ loseContext }) } as unknown as RenderingContext);

    expect(supportsWebGL2()).toBe(true);
    expect(supportsWebGL2()).toBe(true);

    // Un contexte WebGL coûte cher et les navigateurs en limitent le nombre : un seul essai, libéré tout de suite.
    expect(getContext).toHaveBeenCalledTimes(1);
    expect(getContext).toHaveBeenCalledWith("webgl2");
    expect(loseContext).toHaveBeenCalledTimes(1);
  });

  it("répond non sans contexte WebGL2, ou si le navigateur lève une erreur", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    expect(supportsWebGL2()).toBe(false);

    resetWebGL2SupportCache();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => {
      throw new Error("bloqué par le navigateur");
    });
    expect(supportsWebGL2()).toBe(false);
  });
});

describe("usePrefersReducedMotion", () => {
  it("suit la préférence en direct", () => {
    let matches = false;
    const listeners = new Set<() => void>();
    vi.stubGlobal("matchMedia", () => ({
      get matches() {
        return matches;
      },
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    }));
    const { result, unmount } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);

    act(() => {
      matches = true;
      listeners.forEach((listener) => listener());
    });
    expect(result.current).toBe(true);

    // Plus d'écoute une fois le composant démonté.
    unmount();
    expect(listeners.size).toBe(0);
  });

  it("répond non quand le navigateur ne connaît pas matchMedia", () => {
    vi.stubGlobal("matchMedia", undefined);

    expect(renderHook(() => usePrefersReducedMotion()).result.current).toBe(false);
  });
});
