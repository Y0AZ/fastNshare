// Teste les fonctions pures du stockage (clés, messages d'erreur) ; les appels S3 réels relèvent de T3.2.
import { S3ServiceException } from "@aws-sdk/client-s3";
import { buildStorageKey, describeS3Error } from "../../src/libs/storage.js";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

describe("buildStorageKey()", () => {
  it("produit uploads/<uuid v4>.<extension>", () => {
    expect(buildStorageKey("photo.png")).toMatch(new RegExp(`^uploads/${UUID}\\.png$`));
  });

  it("met l'extension en minuscules et ne garde que la dernière", () => {
    expect(buildStorageKey("Archive.TAR.GZ")).toMatch(/\.gz$/);
  });

  it("produit une clé différente pour deux fichiers de même nom", () => {
    expect(buildStorageKey("photo.png")).not.toBe(buildStorageKey("photo.png"));
  });

  // Aucun morceau du nom d'origine n'atteint le bucket, à part une extension strictement alphanumérique.
  it.each([
    ["../../etc/passwd", ""],
    ["rapport", ""],
    [".bashrc", ""],
    ["fichier.", ""],
    ["image.p ng", ""],
    ["script.<svg>", ""],
    ["video.extensiontroplongue", ""],
    ["C:\\Users\\moi\\notes.txt", ".txt"],
  ])("nettoie le nom hostile ou atypique %j", (name, expectedExtension) => {
    const key = buildStorageKey(name);
    expect(key).toMatch(new RegExp(`^uploads/${UUID}${expectedExtension.replace(".", "\\.")}$`));
  });
});

describe("describeS3Error", () => {
  const s3Error = (status: number, name: string) =>
    new S3ServiceException({ name, $fault: "client", $metadata: { httpStatusCode: status }, message: "" });

  it("explique un 403 : identifiants invalides ou droits insuffisants", () => {
    expect(describeS3Error(s3Error(403, "UnknownError"), "fastshare")).toBe(
      'accès refusé au bucket "fastshare" (HTTP 403) : identifiants S3 invalides ou droits insuffisants',
    );
  });

  it("donne le statut HTTP et le nom de l'erreur dans les autres cas", () => {
    expect(describeS3Error(s3Error(500, "InternalError"), "fastshare")).toBe(
      'S3 a répondu HTTP 500 pour le bucket "fastshare" (InternalError)',
    );
  });

  // Refus de connexion : AggregateError (IPv4 + IPv6) au message vide, seul son code est parlant.
  it("signale un endpoint injoignable par son code réseau", () => {
    const refused = Object.assign(new AggregateError([], ""), { code: "ECONNREFUSED" });

    expect(describeS3Error(refused, "fastshare")).toBe("endpoint S3 injoignable (ECONNREFUSED)");
  });

  it("garde le message d'une erreur ordinaire, ou un texte de repli s'il est vide", () => {
    expect(describeS3Error(new Error("délai dépassé"), "fastshare")).toBe("délai dépassé");
    expect(describeS3Error(new Error(""), "fastshare")).toBe("Error");
    expect(describeS3Error("panne", "fastshare")).toBe("panne");
  });
});
