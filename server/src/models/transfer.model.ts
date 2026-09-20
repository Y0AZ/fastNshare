// Modèle Mongoose de la collection `transfers` : un document par envoi, avec ses fichiers embarqués.
import { model, Schema, type InferSchemaType } from "mongoose";

// Sous-document embarqué : les fichiers vivent DANS le transfert, donc une seule écriture atomique crée tout
// (pas de transaction ni de replica set nécessaires). `_id: false` : un fichier n'est jamais adressé seul.
const transferFileSchema = new Schema(
  {
    originalName: { type: String, required: true },
    // Number reste exact jusqu'à 2^53 octets (> 9 Po) : un BigInt serait inutile.
    sizeBytes: { type: Number, required: true, min: 0 },
    // Clé opaque dans le bucket (uploads/<uuid>.<ext>) : c'est la seule piste pour retrouver l'objet S3.
    storageKey: { type: String, required: true },
    contentType: { type: String },
  },
  { _id: false },
);

const transferSchema = new Schema(
  {
    // `unique` crée un index unique : c'est Mongo, pas le code, qui garantit qu'un code n'existe qu'une fois,
    // même si deux envois simultanés tirent le même (le générateur de T1.2 retentera sur l'erreur E11000).
    // `uppercase` normalise à l'écriture : « abc » et « ABC » désignent le même transfert.
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    // Index simple, volontairement PAS un index TTL : Mongo supprimerait les documents sans supprimer
    // les objets S3, qui deviendraient introuvables. Le nettoyage (T2.5) efface S3 d'abord, puis la base.
    expiresAt: { type: Date, required: true, index: true },
    maxDownloads: { type: Number, default: 1, min: 1 },
    downloadCount: { type: Number, default: 0, min: 0 },
    files: {
      type: [transferFileSchema],
      // Un tableau Mongoose vaut [] par défaut, et `required` ne refuse pas un tableau vide : on le vérifie ici.
      validate: {
        validator: (files: unknown[]) => files.length > 0,
        message: "un transfert contient au moins un fichier",
      },
    },
  },
  {
    // createdAt rempli automatiquement à la création et immuable ensuite ; updatedAt n'est pas utile ici.
    timestamps: { createdAt: true, updatedAt: false },
  },
);

// Type TypeScript déduit du schéma : une seule source de vérité pour la forme d'un transfert.
export type TransferData = InferSchemaType<typeof transferSchema>;

// Le nom « Transfer » donne la collection « transfers » (Mongoose met au pluriel et en minuscules).
export const Transfer = model("Transfer", transferSchema);
