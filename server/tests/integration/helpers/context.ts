// Contexte d'un fichier de test d'intégration : sa base Mongo et son bucket à lui, le vrai stockage S3, l'app
// réelle, et de quoi inspecter le bucket (orphelins, multiparts inachevés).
import {
  AbortMultipartUploadCommand,
  DeleteObjectsCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import type { Express } from "express";
import mongoose from "mongoose";
import { type AppDependencies, createApp } from "../../../src/app.js";
import { createStorage, type Storage } from "../../../src/libs/storage.js";
import type { UploadLimits } from "../../../src/middlewares/upload.js";
import { Transfer } from "../../../src/models/transfer.model.js";

const MiB = 1024 * 1024;
// Limites abaissées pour vérifier les refus avec quelques Mo. 8 Mio reste au-dessus des parties de 5 Mo du
// multipart upload : un fichier de 12 Mio passe donc vraiment par un multipart S3 avant d'être refusé.
export const TEST_UPLOAD_LIMITS: UploadLimits = {
  maxFileSizeBytes: 8 * MiB,
  maxFiles: 5,
  maxTotalBytes: 16 * MiB,
};

export type IntegrationContext = {
  storage: Storage;
  bucket: string;
  // App réelle sur les vraies dépendances ; une app neuve par appel (rate limit remis à zéro).
  app: (overrides?: Partial<AppDependencies>) => Express;
  // Vide la base et le bucket : chaque scénario part d'un état connu.
  reset: () => Promise<void>;
  listObjectKeys: () => Promise<string[]>;
  countIncompleteMultipartUploads: () => Promise<number>;
  close: () => Promise<void>;
};

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} absent : lancer ces tests avec npm run test:integration (Docker démarré)`);
  return value;
}

// `name` distingue les fichiers de test : chacun a sa base et son bucket, ils peuvent donc tourner en parallèle
// sur les mêmes conteneurs sans se voir.
export async function createIntegrationContext(name: string): Promise<IntegrationContext> {
  const bucket = `it-${name}`;
  const endpoint = requiredEnv("INTEGRATION_S3_ENDPOINT");
  const credentials = {
    accessKeyId: requiredEnv("INTEGRATION_S3_ACCESS_KEY_ID"),
    secretAccessKey: requiredEnv("INTEGRATION_S3_SECRET_ACCESS_KEY"),
  };

  // directConnection : Testcontainers démarre Mongo en replica set à un membre, annoncé sous un nom interne au
  // conteneur ; sans cette option, le pilote chercherait à joindre ce nom, introuvable depuis l'hôte.
  await mongoose.connect(`${requiredEnv("INTEGRATION_MONGODB_URL")}/it_${name}?directConnection=true`, {
    serverSelectionTimeoutMS: 10_000,
  });
  // Index unique sur `code` créé pour de vrai : c'est lui qui arbitre les doublons, pas une simulation.
  await Transfer.init();

  const storage = createStorage({
    endpoint,
    region: "us-east-1",
    bucket,
    ...credentials,
    forcePathStyle: true,
  });
  await storage.ensureBucket();
  // Client S3 séparé, réservé à l'inspection du bucket : le code testé ne sait pas lister, et n'en a pas besoin.
  const s3 = new S3Client({ endpoint, region: "us-east-1", credentials, forcePathStyle: true });

  const listObjectKeys = async () => {
    const { Contents = [] } = await s3.send(new ListObjectsV2Command({ Bucket: bucket }));
    return Contents.flatMap(({ Key }) => (Key ? [Key] : []));
  };
  const listMultipartUploads = async () =>
    (await s3.send(new ListMultipartUploadsCommand({ Bucket: bucket }))).Uploads ?? [];

  return {
    storage,
    bucket,
    app: (overrides = {}) => createApp({ storage, uploadLimits: TEST_UPLOAD_LIMITS, ...overrides }),
    listObjectKeys,
    countIncompleteMultipartUploads: async () => (await listMultipartUploads()).length,
    async reset() {
      await Transfer.deleteMany({});
      const keys = await listObjectKeys();
      if (keys.length > 0) {
        await s3.send(
          new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys.map((Key) => ({ Key })) } }),
        );
      }
      // Un multipart laissé par un scénario fausserait le décompte du suivant.
      for (const { Key, UploadId } of await listMultipartUploads()) {
        await s3.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key, UploadId }));
      }
    },
    async close() {
      await mongoose.disconnect();
      s3.destroy();
    },
  };
}
