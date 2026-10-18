// Couche de stockage : seul module à connaître le SDK AWS. Le reste du code ne voit que l'interface Storage,
// donc changer de fournisseur S3 (SeaweedFS en local, R2/S3/B2 en production) ne coûte qu'un changement de config.
import { randomUUID } from "node:crypto";
import path from "node:path";
import { Readable } from "node:stream";
import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

export type StorageConfig = {
  // Absent pour AWS S3 (le SDK déduit l'URL de la région) ; requis pour R2, B2, SeaweedFS…
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
};

export type DeleteResult = {
  deleted: number;
  // Clés que S3 n'a pas pu supprimer : l'appelant les conserve pour réessayer plus tard (voir T2.5).
  failed: { key: string; reason: string }[];
};

export interface Storage {
  ensureBucket(): Promise<void>;
  putStream(
    key: string,
    stream: Readable,
    options?: { contentType?: string; signal?: AbortSignal },
  ): Promise<void>;
  getStream(key: string): Promise<Readable>;
  exists(key: string): Promise<boolean>;
  deleteObjects(keys: string[]): Promise<DeleteResult>;
}

// Limite imposée par l'API S3 : une requête DeleteObjects accepte au plus 1000 clés.
const DELETE_BATCH_SIZE = 1000;

function isNotFound(error: unknown): boolean {
  return error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Les erreurs brutes sont illisibles au démarrage : une réponse HEAD n'a pas de corps (le SDK la nomme
// « UnknownError »), et un refus de connexion arrive en AggregateError IPv4 + IPv6 au message vide.
function describeS3Error(error: unknown, bucket: string): string {
  if (error instanceof S3ServiceException) {
    const status = error.$metadata.httpStatusCode;
    if (status === 403) {
      return `accès refusé au bucket "${bucket}" (HTTP 403) : identifiants S3 invalides ou droits insuffisants`;
    }
    return `S3 a répondu HTTP ${status ?? "?"} pour le bucket "${bucket}" (${error.name})`;
  }
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string") return `endpoint S3 injoignable (${code})`;
  return errorMessage(error) || "erreur S3 inconnue";
}

// Clé opaque plutôt que le nom d'origine : deux fichiers « photo.png » ne s'écrasent pas, et un nom hostile
// (« ../../etc/passwd », caractères de contrôle, 2000 caractères) n'arrive jamais jusqu'au bucket.
// Le nom d'origine reste en base (files[].originalName) pour le ZIP. L'extension, nettoyée, aide seulement
// à reconnaître un objet en parcourant le bucket.
export function buildStorageKey(originalName: string): string {
  const extension = path.extname(originalName).slice(1).toLowerCase();
  const safeExtension = /^[a-z0-9]{1,10}$/.test(extension) ? `.${extension}` : "";
  return `uploads/${randomUUID()}${safeExtension}`;
}

export function createStorage(config: StorageConfig): Storage {
  const { bucket } = config;
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    // Path-style (http://hôte/bucket/clé) : nécessaire pour SeaweedFS et la plupart des S3 auto-hébergés,
    // qui ne savent pas répondre sur un sous-domaine par bucket (virtual-hosted-style : http://bucket.hôte/clé).
    forcePathStyle: config.forcePathStyle,
  });

  return {
    // Crée le bucket s'il manque (dev, tests). En production il est créé à la main et la clé n'a souvent
    // pas le droit d'en créer : HeadBucket suffit alors, et un 403 (mauvaise clé) fait échouer le démarrage.
    async ensureBucket() {
      try {
        try {
          await client.send(new HeadBucketCommand({ Bucket: bucket }));
        } catch (error) {
          if (!isNotFound(error)) throw error;
          await client.send(new CreateBucketCommand({ Bucket: bucket }));
        }
      } catch (error) {
        // `cause` conserve l'erreur d'origine (pile, métadonnées) pour le débogage.
        throw new Error(describeS3Error(error, bucket), { cause: error });
      }
    },

    // Upload découpe le flux en parties de 5 Mo envoyées en multipart upload : la taille totale n'a pas besoin
    // d'être connue d'avance, et la mémoire reste bornée (au plus 4 parties en vol, soit ~20 Mo).
    // Backpressure : Upload ne lit le flux qu'au rythme où il envoie les parties, la source est donc freinée.
    // En cas d'erreur, Upload annule lui-même le multipart (leavePartsOnError: false par défaut) : aucune partie
    // orpheline facturée dans le bucket.
    async putStream(key, stream, { contentType, signal } = {}) {
      const upload = new Upload({
        client,
        params: { Bucket: bucket, Key: key, Body: stream, ContentType: contentType },
      });
      // Annulation par destruction du flux source, PAS par upload.abort() : abort() rejette done() aussitôt alors
      // qu'un PUT déjà parti peut encore aboutir, d'où un objet créé après l'échec annoncé (constaté sur SeaweedFS).
      // Flux détruit → Upload échoue normalement : done() attend les envois en vol, annule le multipart, puis dit vrai.
      const onAbort = () => stream.destroy(new Error("envoi annulé"));
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        await upload.done();
      } finally {
        signal?.removeEventListener("abort", onAbort);
      }
    },

    async getStream(key) {
      const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      // Sous Node, le SDK renvoie un flux Readable ; la vérification protège d'un changement de runtime.
      if (!(response.Body instanceof Readable)) {
        throw new Error(`corps de réponse inattendu pour la clé ${key}`);
      }
      return response.Body;
    },

    async exists(key) {
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return true;
      } catch (error) {
        if (isNotFound(error)) return false;
        throw error;
      }
    },

    // Supprimer une clé absente n'est pas une erreur pour S3 : l'opération est idempotente, on peut la rejouer.
    // Un lot qui échoue entièrement (réseau, droits) n'arrête pas les suivants : ses clés sont signalées en échec.
    async deleteObjects(keys) {
      const result: DeleteResult = { deleted: 0, failed: [] };
      for (let start = 0; start < keys.length; start += DELETE_BATCH_SIZE) {
        const batch = keys.slice(start, start + DELETE_BATCH_SIZE);
        try {
          // Quiet : S3 ne renvoie que les échecs, pas la liste de tout ce qui a été supprimé.
          const response = await client.send(
            new DeleteObjectsCommand({
              Bucket: bucket,
              Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
            }),
          );
          const errors = response.Errors ?? [];
          result.deleted += batch.length - errors.length;
          for (const error of errors) {
            result.failed.push({ key: error.Key ?? "?", reason: error.Message ?? error.Code ?? "inconnue" });
          }
        } catch (error) {
          for (const key of batch) result.failed.push({ key, reason: errorMessage(error) });
        }
      }
      return result;
    },
  };
}
