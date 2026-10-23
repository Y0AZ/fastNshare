// Construction d'un ZIP à la volée : les fichiers sont lus depuis le stockage et ajoutés au fil de l'envoi,
// sans fichier temporaire ni archive complète en mémoire.
import { once } from "node:events";
import path from "node:path";
import { pipeline, type Readable, Transform } from "node:stream";
import { ZipArchive } from "archiver";

export type ZipEntrySource = {
  name: string;
  // Taille exacte du contenu : elle sert à annoncer la taille de l'archive avant de l'envoyer.
  sizeBytes: number;
  // Ouverture différée : le flux S3 d'un fichier n'est ouvert qu'à son tour, pas tous d'un coup au départ.
  open: () => Promise<Readable>;
};

// Défense contre le « zip slip » : un nom d'entrée contenant « ../ » ou un chemin absolu ferait écrire le
// décompresseur hors du dossier choisi par le destinataire. Le nom vient du client, il n'est donc pas fiable.
export function sanitizeEntryName(name: string): string {
  const cleaned = name
    .replace(/[/\\]/g, "_")
    // Caractères de contrôle (retour chariot, octet nul…) : invisibles ou refusés par les systèmes de fichiers.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  return cleaned === "" || cleaned === "." || cleaned === ".." ? "fichier" : cleaned;
}

// Deux entrées de même nom s'écraseraient à l'extraction : « a.txt », « a (2).txt », « a (3).txt »…
// Comparaison sans tenir compte de la casse : sous Windows et macOS, « A.txt » et « a.txt » sont le même fichier.
export function dedupeEntryNames(names: string[]): string[] {
  const taken = new Set<string>();
  return names.map((original) => {
    const name = sanitizeEntryName(original);
    const extension = path.extname(name);
    const base = name.slice(0, name.length - extension.length);
    let candidate = name;
    for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${base} (${n})${extension}`;
    taken.add(candidate.toLowerCase());
    return candidate;
  });
}

// Structure d'un ZIP « store » écrit par archiver depuis des flux (vérifiée en inspectant ses archives) :
// par fichier, en-tête local (30 o + nom), contenu, descripteur de données signé (16 o), entrée du répertoire
// central (46 o + nom) ; puis fin de répertoire central (22 o). Ni champ extra, ni commentaire.
const PER_ENTRY_OVERHEAD = 30 + 16 + 46;
const END_OF_CENTRAL_DIRECTORY = 22;
// Au-delà de 4 Gio, archiver passe au format Zip64, aux structures plus longues : la formule ne vaut plus.
const ZIP32_MAX = 0xffffffff;

// Taille exacte de l'archive, ou undefined si elle ne peut pas être garantie (Zip64).
export function computeZipSize(entries: { name: string; sizeBytes: number }[]): number | undefined {
  let total = END_OF_CENTRAL_DIRECTORY;
  for (const entry of entries) {
    if (entry.sizeBytes >= ZIP32_MAX) return undefined;
    // Le nom est compté deux fois (en-tête local et répertoire central), en octets UTF-8, pas en caractères.
    total += PER_ENTRY_OVERHEAD + 2 * Buffer.byteLength(entry.name) + entry.sizeBytes;
  }
  return total < ZIP32_MAX ? total : undefined;
}

// Garde-fou du Content-Length : un fichier plus court ou plus long que prévu rendrait l'archive incohérente avec
// la taille annoncée (le navigateur attendrait des octets qui ne viendront jamais, ou couperait trop tôt).
// L'écart fait échouer l'archive, et donc couper la connexion : un échec visible plutôt qu'un fichier corrompu.
function expectExactSize(expected: number, name: string): Transform {
  let received = 0;
  const mismatch = () =>
    new Error(`taille inattendue pour « ${name} » : ${received} o reçus, ${expected} o annoncés`);
  return new Transform({
    transform(chunk: Buffer, _encoding, next) {
      received += chunk.length;
      next(received > expected ? mismatch() : null, chunk);
    },
    flush(next) {
      next(received === expected ? null : mismatch());
    },
  });
}

export type ZipStream = {
  stream: ZipArchive;
  // Taille exacte de l'archive (en-tête Content-Length), ou undefined si elle n'est pas calculable.
  sizeBytes: number | undefined;
};

// L'archive est remplie en arrière-plan. Le consommateur (la réponse HTTP) impose son rythme : archiver ne lit
// le fichier S3 en cours qu'au fur et à mesure qu'il peut écrire (backpressure).
// Une erreur (fichier S3 illisible, taille inattendue) détruit l'archive avec cette erreur ; à l'inverse, si le
// consommateur détruit l'archive (client parti), le flux S3 en cours est fermé et les suivants ne sont pas ouverts.
export function createZipStream(entries: ZipEntrySource[]): ZipStream {
  // Sans compression : c'est ce qui rend la taille calculable à l'avance (une taille compressée ne se connaît
  // qu'après coup), donc la barre de progression possible. Coût : une archive aussi grosse que les fichiers,
  // perte faible puisque la plupart des envois (photos, vidéos, PDF) sont déjà compressés.
  const archive = new ZipArchive({ store: true });
  // Les noms définitifs servent à la fois à l'archive et au calcul de taille : ils doivent être identiques.
  const names = dedupeEntryNames(entries.map((entry) => entry.name));
  const named = entries.map((entry, index) => ({ ...entry, name: names[index] ?? `fichier-${index + 1}` }));
  const stopped = new AbortController();
  let current: Readable | undefined;

  archive.once("close", () => {
    stopped.abort();
    current?.destroy();
  });

  void (async () => {
    try {
      for (const { name, sizeBytes, open } of named) {
        current = await open();
        if (stopped.signal.aborted) {
          current.destroy();
          return;
        }
        // archiver n'écoute pas les erreurs des flux qu'on lui confie : un flux S3 coupé ou une taille inattendue
        // le laisseraient attendre indéfiniment une fin qui ne vient pas (téléchargement suspendu, constaté en
        // test). pipeline relie S3 au contrôle de taille et signale toute erreur, qu'on reporte sur l'archive.
        const checked = pipeline(current, expectExactSize(sizeBytes, name), (error) => {
          if (error) archive.destroy(error);
        });
        // Une entrée à la fois : on attend qu'archiver ait fini de lire ce fichier avant d'ouvrir le suivant.
        // `signal` débloque l'attente si l'archive est détruite entre-temps.
        const entryDone = once(archive, "entry", { signal: stopped.signal });
        archive.append(checked, { name });
        await entryDone;
      }
      await archive.finalize();
    } catch (error) {
      archive.destroy(error instanceof Error ? error : new Error(String(error)));
    }
  })();

  return { stream: archive, sizeBytes: computeZipSize(named) };
}
