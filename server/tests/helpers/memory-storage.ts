// Stockage en mémoire qui respecte l'interface Storage : les tests unitaires vérifient ce qui a été écrit
// (ou bien supprimé) sans démarrer de moteur S3.
import { Readable } from "node:stream";
import type { DeleteResult, Storage } from "../../src/libs/storage.js";

export type MemoryStorage = Storage & {
  objects: Map<string, Buffer>;
  deletedKeys: string[];
};

type MemoryStorageOptions = {
  // Simule une panne S3 sur l'écriture.
  failPut?: boolean;
  // Retient chaque écriture jusqu'à l'appel de la fonction reçue : sert à rejouer une course (annulation en vol).
  holdPut?: (release: () => void) => void;
};

export function createMemoryStorage({ failPut = false, holdPut }: MemoryStorageOptions = {}): MemoryStorage {
  const objects = new Map<string, Buffer>();
  const deletedKeys: string[] = [];

  return {
    objects,
    deletedKeys,
    async ensureBucket() {},

    // Lit le flux jusqu'au bout comme le ferait S3 : un flux qui échoue en route fait échouer l'écriture.
    async putStream(key, stream) {
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(chunk as Buffer);
      if (holdPut) await new Promise<void>((resolve) => holdPut(resolve));
      if (failPut) throw new Error("S3 injoignable (simulé)");
      objects.set(key, Buffer.concat(chunks));
    },

    async getStream(key) {
      const object = objects.get(key);
      if (!object) throw new Error(`objet absent : ${key}`);
      return Readable.from(object);
    },

    async getSize(key) {
      return objects.get(key)?.length;
    },

    async deleteObjects(keys): Promise<DeleteResult> {
      for (const key of keys) {
        objects.delete(key);
        deletedKeys.push(key);
      }
      return { deleted: keys.length, failed: [] };
    },
  };
}
