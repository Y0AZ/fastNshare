// Démarre UNE fois, pour toute la suite d'intégration, un MongoDB et un SeaweedFS éphémères (Testcontainers).
// Chaque fichier de test y crée ensuite sa propre base et son propre bucket (voir helpers/context.ts).
import { MongoDBContainer } from "@testcontainers/mongodb";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";

// Mêmes images et mêmes réglages que docker-compose.yml : les tests visent ce qui tourne en développement.
const MONGO_IMAGE = "mongo:9.0.8";
const SEAWEEDFS_IMAGE = "chrislusf/seaweedfs:4.54";
// Identifiants du SeaweedFS éphémère, valables le temps de la suite seulement.
const S3_ACCESS_KEY_ID = "integration-access-key";
const S3_SECRET_ACCESS_KEY = "integration-secret-key";

declare global {
  // Conservés pour global-teardown.ts, qui s'exécute dans le même contexte que ce fichier.
  var integrationContainers: StartedTestContainer[] | undefined;
}

export default async function globalSetup(): Promise<void> {
  // Démarrage en parallèle : le plus lent des deux fixe la durée, pas leur somme.
  const [mongo, s3] = await Promise.all([
    new MongoDBContainer(MONGO_IMAGE).start(),
    new GenericContainer(SEAWEEDFS_IMAGE)
      .withCommand(["mini", "-dir=/data", "-master.telemetry=false"])
      .withEnvironment({ AWS_ACCESS_KEY_ID: S3_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY: S3_SECRET_ACCESS_KEY })
      .withExposedPorts(8333)
      // Même sonde que le healthcheck du compose : la passerelle S3 répond 200 sur /healthz quand elle est prête.
      .withWaitStrategy(Wait.forHttp("/healthz", 8333).forStatusCode(200))
      .start(),
  ]);
  globalThis.integrationContainers = [mongo, s3];

  // Les variables d'environnement sont le seul canal vers les fichiers de test : Jest les lance dans des
  // processus séparés, créés APRÈS ce globalSetup, qui héritent donc de process.env. (Un import partagé n'est
  // pas possible : Jest charge ce fichier hors de son système de modules, sans la résolution des « .js ».)
  process.env.INTEGRATION_MONGODB_URL = mongo.getConnectionString();
  process.env.INTEGRATION_S3_ENDPOINT = `http://${s3.getHost()}:${s3.getMappedPort(8333)}`;
  process.env.INTEGRATION_S3_ACCESS_KEY_ID = S3_ACCESS_KEY_ID;
  process.env.INTEGRATION_S3_SECRET_ACCESS_KEY = S3_SECRET_ACCESS_KEY;
}
