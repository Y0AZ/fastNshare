// Lecteur de ZIP minimal pour les tests : extrait les fichiers d'une archive « store » (sans compression), le
// seul format que produit le serveur. Évite une dépendance de plus juste pour relire nos propres archives.
// Il part du répertoire central, en fin d'archive : c'est lui qui donne taille et position de chaque entrée
// (les en-têtes locaux n'ont pas les tailles, écrites après les données dans un descripteur).

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;

export function readStoredZip(archive: Buffer): Map<string, Buffer> {
  // Fin du répertoire central : 22 derniers octets (le serveur n'écrit pas de commentaire d'archive).
  const end = archive.length - 22;
  if (archive.readUInt32LE(end) !== END_OF_CENTRAL_DIRECTORY) throw new Error("fin de ZIP introuvable");
  const entryCount = archive.readUInt16LE(end + 10);
  let offset = archive.readUInt32LE(end + 16);

  const files = new Map<string, Buffer>();
  for (let i = 0; i < entryCount; i++) {
    if (archive.readUInt32LE(offset) !== CENTRAL_DIRECTORY_ENTRY) throw new Error(`entrée ${i} invalide`);
    const method = archive.readUInt16LE(offset + 10);
    if (method !== 0) throw new Error(`entrée ${i} compressée (méthode ${method}) : non prise en charge`);
    const size = archive.readUInt32LE(offset + 20);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localHeader = archive.readUInt32LE(offset + 42);
    const name = archive.toString("utf8", offset + 46, offset + 46 + nameLength);

    if (archive.readUInt32LE(localHeader) !== LOCAL_FILE_HEADER)
      throw new Error(`en-tête local de ${name} invalide`);
    const dataStart =
      localHeader + 30 + archive.readUInt16LE(localHeader + 26) + archive.readUInt16LE(localHeader + 28);
    files.set(name, archive.subarray(dataStart, dataStart + size));

    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}
