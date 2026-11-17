// Coquille de l'application : en-tête, onglets Envoyer / Recevoir, rappel des règles et zone des notifications.
import { Clock, Download, Send, Upload } from "lucide-react";
import { ReceiveTab } from "@/components/ReceiveTab";
import { SendTab } from "@/components/SendTab";
import { ServerWakeBanner } from "@/components/ServerWakeBanner";
import { Toaster } from "@/components/ui/sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TRANSFER_TTL_DAYS } from "@/lib/config";

function App() {
  return (
    // Une seule colonne étroite centrée : lisible de 375 px (petit téléphone) à l'écran de bureau. min-h-svh :
    // hauteur visible réelle sur mobile, sans la barre d'adresse qui fausse 100vh.
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <header className="mx-auto w-full max-w-xl px-4 pt-10 pb-6 text-center">
        <div className="flex items-center justify-center gap-2">
          <Send className="size-7 text-primary" aria-hidden />
          <h1 className="text-3xl font-bold tracking-tight">Fast&amp;Share</h1>
        </div>
        <p className="mt-2 text-muted-foreground">
          Transférez vos fichiers avec un simple code, sans compte.
        </p>
      </header>

      {/* Entre l'en-tête et les onglets : visible sans masquer l'interface, que l'on peut déjà utiliser. */}
      <ServerWakeBanner />

      <main className="mx-auto w-full max-w-xl flex-1 px-4">
        <Tabs defaultValue="send">
          {/* activateOnFocus : les flèches changent d'onglet directement (recommandation WAI-ARIA quand le contenu
              s'affiche instantanément) ; Base UI gère role="tablist", le focus itinérant et aria-selected. */}
          <TabsList className="w-full" activateOnFocus>
            <TabsTrigger value="send">
              <Upload aria-hidden />
              Envoyer
            </TabsTrigger>
            <TabsTrigger value="receive">
              <Download aria-hidden />
              Recevoir
            </TabsTrigger>
          </TabsList>
          {/* keepMounted : l'onglet masqué reste monté (caché). Sans cela, passer sur « Recevoir » pendant un envoi
              détruirait l'état de l'onglet « Envoyer » et sa progression. */}
          <TabsContent value="send" keepMounted className="pt-4">
            <SendTab />
          </TabsContent>
          <TabsContent value="receive" keepMounted className="pt-4">
            <ReceiveTab />
          </TabsContent>
        </Tabs>
      </main>

      <footer className="mx-auto flex w-full max-w-xl items-center justify-center gap-2 px-4 py-8 text-center text-sm text-muted-foreground">
        <Clock className="size-4 shrink-0" aria-hidden />
        <p>Les transferts expirent après {TRANSFER_TTL_DAYS} jours et ne sont téléchargeables qu'une fois.</p>
      </footer>

      {/* Thème clair imposé : le composant shadcn suit sinon le thème du système, et afficherait des notifications
          sombres sur cette page claire (l'app n'a pas de mode sombre). */}
      <Toaster theme="light" position="top-center" />
    </div>
  );
}

export default App;
