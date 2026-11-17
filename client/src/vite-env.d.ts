// Types des variables d'environnement Vite (import.meta.env), qui seraient sinon typées `any`.

// Mode strict : une variable non déclarée ci-dessous devient une erreur de compilation. Une faute de frappe
// (VITE_API_ULR) est ainsi signalée par TypeScript au lieu de valoir undefined en silence.
interface ViteTypeOptions {
  strictImportMetaEnv: unknown;
}

interface ImportMetaEnv {
  // URL de l'API ; absente en local si client/.env n'existe pas (repli dans lib/config.ts).
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
