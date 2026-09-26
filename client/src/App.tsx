// Page provisoire de T0.4 : prouve que Tailwind, l'alias @ et les composants shadcn fonctionnent ensemble.
// Elle sera remplacée par la coquille de l'interface (onglets Envoyer / Recevoir) en T4.1.
import { Button } from "@/components/ui/button";

function App() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-4 text-foreground">
      <h1 className="text-4xl font-bold tracking-tight">Fast&amp;Share</h1>
      <p className="text-muted-foreground">Transfert de fichiers par code, sans compte.</p>
      <Button>Commencer</Button>
    </main>
  );
}

export default App;
