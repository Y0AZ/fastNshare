// Génération et normalisation des codes de transfert : le code est la seule barrière d'accès aux fichiers.
import { randomInt } from "node:crypto";
import { CODE_ALPHABET, CODE_LENGTH } from "../configs/limits.js";

// crypto.randomInt puise dans le générateur cryptographique du système : les codes sont imprévisibles.
// Math.random() ne l'est pas (son état interne peut être reconstitué à partir de quelques sorties).
// randomInt(n) est aussi uniforme : il rejette en interne les tirages qui biaiseraient le résultat (rejection sampling).
export function generateCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

// Saisie utilisateur → forme stockée en base (le modèle met aussi le code en majuscules à l'écriture).
export function normalizeCode(input: string): string {
  return input.trim().toUpperCase();
}

const CODE_PATTERN = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);

// À appliquer après normalizeCode : un code mal formé ne peut pas exister, inutile d'interroger la base.
export function isValidCode(code: string): boolean {
  return CODE_PATTERN.test(code);
}

// Erreur d'index unique (E11000) portant sur le champ `code`. On ne retente que dans ce cas précis :
// un doublon sur un autre index, ou toute autre erreur, est un vrai problème à remonter tel quel.
function isDuplicateCodeError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, keyPattern } = error as { code?: unknown; keyPattern?: Record<string, unknown> };
  return code === 11000 && keyPattern !== undefined && "code" in keyPattern;
}

type UniqueCodeOptions = {
  maxAttempts?: number;
  // Injectable pour que les tests simulent un doublon de façon déterministe.
  generate?: () => string;
};

// Tire un code et appelle `insert(code)` ; si l'index unique refuse le code (E11000), retire et recommence.
// On n'interroge PAS la base avant d'insérer : entre « le code est libre » et l'insertion, une requête simultanée
// pourrait prendre le même code. Seule l'insertion, arbitrée par l'index unique, est une vérification fiable.
// Avec 31^8 combinaisons, une collision est déjà rarissime : 5 tentatives sont un plafond de sécurité.
export async function generateUniqueCode<T>(
  insert: (code: string) => Promise<T>,
  { maxAttempts = 5, generate = generateCode }: UniqueCodeOptions = {},
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await insert(generate());
    } catch (error) {
      if (!isDuplicateCodeError(error)) throw error;
    }
  }
  throw new Error(`impossible d'obtenir un code unique après ${maxAttempts} tentatives`);
}
