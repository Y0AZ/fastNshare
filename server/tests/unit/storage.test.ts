// Teste la construction des clés de stockage (fonction pure) ; les appels S3 réels sont vérifiés contre le compose.
import { buildStorageKey } from "../../src/libs/storage.js";

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
