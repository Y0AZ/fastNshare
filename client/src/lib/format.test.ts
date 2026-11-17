// Teste la mise en forme française des tailles et des dates.
import { describe, expect, it } from "vitest";
import { formatBytes, formatDateTime, formatSeconds, NO_BREAK_SPACE } from "./format";

// Les attentes sont écrites avec une espace ordinaire puis converties : plus lisible qu'un caractère invisible.
const withNbsp = (text: string) => text.replace(" ", NO_BREAK_SPACE);

describe("formatBytes", () => {
  it.each([
    [0, "0 o"],
    [512, "512 o"],
    [1024, "1 Ko"],
    [1536, "1,5 Ko"],
    [12.4 * 1024 * 1024, "12,4 Mo"],
    [200 * 1024 * 1024, "200 Mo"],
    [3 * 1024 ** 3, "3 Go"],
  ])("%d octets → « %s »", (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(withNbsp(expected));
  });
});

describe("formatDateTime", () => {
  it("écrit la date en toutes lettres, en français", () => {
    // Midi UTC : le jour reste le même dans tous les fuseaux d'Europe, quel que soit celui de la machine de test.
    expect(formatDateTime("2026-12-01T12:00:00.000Z")).toMatch(/^1 décembre 2026 à \d{2}:00$/);
  });
});

describe("formatSeconds", () => {
  it.each([
    [0, "0,0 s"],
    [4200, "4,2 s"],
    [12_345, "12,3 s"],
  ])("%d ms → « %s »", (milliseconds, expected) => {
    expect(formatSeconds(milliseconds)).toBe(withNbsp(expected));
  });
});
