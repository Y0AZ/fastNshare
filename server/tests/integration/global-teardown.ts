// Arrête les conteneurs démarrés par global-setup.ts. En cas d'arrêt brutal de Jest, Testcontainers les supprime
// quand même : son conteneur « Ryuk » détruit tout ce qu'une session a créé dès que la session disparaît.
export default async function globalTeardown(): Promise<void> {
  await Promise.all((globalThis.integrationContainers ?? []).map((container) => container.stop()));
}
