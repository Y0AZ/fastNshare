// Construction d'un ZIP à la volée : les fichiers sont lus depuis le stockage et compressés au fil de l'envoi,
// sans fichier temporaire ni archive complète en mémoire.
import { once } from "node:events";
import path from "node:path";
import type { Readable } from "node:stream";
import { ZipArchive } from "archiver";

export type ZipEntrySource = {
  name: string;
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

// Renvoie l'archive sous forme de flux, remplie en arrière-plan. Le consommateur (la réponse HTTP) impose
// son rythme : archiver ne lit le fichier S3 en cours qu'au fur et à mesure qu'il peut écrire (backpressure).
// Une erreur (fichier S3 illisible…) détruit l'archive avec cette erreur ; à l'inverse, si le consommateur
// détruit l'archive (client parti), le flux S3 en cours est fermé et les fichiers suivants ne sont jamais ouverts.
export function createZipStream(entries: ZipEntrySource[]): ZipArchive {
  // Niveau 1 : compression rapide. Beaucoup de fichiers envoyés (photos, vidéos, PDF) sont déjà compressés,
  // un niveau élevé coûterait du CPU au serveur pour presque rien.
  const archive = new ZipArchive({ zlib: { level: 1 } });
  const names = dedupeEntryNames(entries.map((entry) => entry.name));
  const stopped = new AbortController();
  let current: Readable | undefined;

  archive.once("close", () => {
    stopped.abort();
    current?.destroy();
  });

  void (async () => {
    try {
      for (const [index, entry] of entries.entries()) {
        current = await entry.open();
        if (stopped.signal.aborted) {
          current.destroy();
          return;
        }
        // Une entrée à la fois : on attend qu'archiver ait fini de lire ce fichier avant d'ouvrir le suivant.
        // `signal` débloque l'attente si l'archive est détruite entre-temps.
        const entryDone = once(archive, "entry", { signal: stopped.signal });
        archive.append(current, { name: names[index] ?? `fichier-${index + 1}` });
        await entryDone;
      }
      await archive.finalize();
    } catch (error) {
      archive.destroy(error instanceof Error ? error : new Error(String(error)));
    }
  })();

  return archive;
}
