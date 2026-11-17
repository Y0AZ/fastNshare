// Bulle de la page : toujours présente en tête des onglets Envoyer et Recevoir. INERTE au repos (preset « eclipse »,
// gris neutre, décorative), ACTIVE pendant un chargement (preset « frost », bleu, remplie selon la progression,
// pourcentage au centre). Deux couches séparées : la SÉMANTIQUE (role="progressbar", seulement quand elle mesure
// quelque chose) et le RENDU décoratif : la boule de cristal WebGL de React Bits, sinon la bulle SVG.
import { lazy, Suspense, useId } from "react";
import { supportsWebGL2, usePrefersReducedMotion } from "@/lib/graphics";
import { clampPercent, FINALIZING_LABEL, formatPercent } from "@/lib/progress";
import { cn } from "@/lib/utils";

// Chargement paresseux : le composant (≈ 1 500 lignes) et la bibliothèque ogl forment un fichier JavaScript séparé,
// téléchargé seulement quand une bulle s'affiche, et jamais par un navigateur qui ne pourrait pas l'utiliser.
const CrystalizedBall = lazy(() => import("@/components/react-bits/CrystalizedBall"));

// Moins de particules que les presets (14 000 à 16 000) : assez pour lire la montée, moins de travail GPU. Même
// nombre dans les deux états : changer de preset ne reconstruit alors pas les particules, seule la couleur change.
const BALL_PARTICLES = 10_000;
const IDLE_PRESET = "eclipse";
const ACTIVE_PRESET = "frost";

type ProgressBubbleProps = {
  // Pourcentage 0–100 d'un chargement en cours ; absent → bulle inerte. Toute valeur est ramenée dans 0–100.
  value?: number;
  // Envoi terminé côté navigateur, mais le serveur n'a pas encore répondu (écriture vers S3 en cours).
  finalizing?: boolean;
  // Nom accessible : ce que mesure la barre (pendant un chargement).
  label?: string;
  // Fichiers en cours de préparation par le navigateur (compression d'une application, d'un dossier) : la bulle
  // garde sa couleur inerte mais « respire » (opacité qui monte et descend en douceur). Toujours décorative :
  // l'état est annoncé à côté.
  preparing?: boolean;
  className?: string;
};

export function ProgressBubble({
  value,
  finalizing = false,
  label = "Progression de l'envoi",
  preparing = false,
  className,
}: ProgressBubbleProps) {
  const active = finalizing || value !== undefined;
  // Pendant la finalisation, tout est envoyé : la bulle est pleine, seul le libellé change.
  const percent = finalizing ? 100 : clampPercent(value ?? 0);
  const text = finalizing ? FINALIZING_LABEL : formatPercent(percent);
  // Repli sans WebGL2 (le composant React Bits resterait vide, sans erreur) ou si l'utilisateur demande moins
  // d'animations : une boule de particules en mouvement permanent est exactement ce qu'il veut éviter.
  const reducedMotion = usePrefersReducedMotion();
  const useBall = !reducedMotion && supportsWebGL2();
  // Le SVG ne sert que pendant un chargement : au repos, un cercle vide « 0 % » ferait croire à une opération.
  const svg = active ? <SvgBubble percent={percent} text={text} finalizing={finalizing} /> : null;

  return (
    <div
      // Rôle de barre de progression seulement quand la bulle mesure un chargement ; au repos, pur décor.
      {...(active
        ? {
            role: "progressbar",
            "aria-label": label,
            "aria-valuemin": 0,
            "aria-valuemax": 100,
            "aria-valuenow": percent,
            // aria-valuetext : ce que le lecteur d'écran annonce à la place du nombre brut.
            "aria-valuetext": text,
          }
        : { "aria-hidden": true })}
      className={cn(
        "relative aspect-square w-48 transition-[width,opacity] duration-500",
        // animate-pulse (Tailwind) : opacité 100 % → 50 % → 100 % en 2 s, courbe adoucie, en boucle.
        // motion-safe : désactivée si l'utilisateur demande moins d'animations.
        preparing && !active && "motion-safe:animate-pulse",
        className,
      )}
    >
      {useBall ? (
        // Le SVG (ou rien, au repos) s'affiche le temps que le fichier de la boule arrive.
        <Suspense fallback={svg}>
          {/* Toujours le MÊME élément CrystalizedBall, à la même place : passer d'inerte à actif change ses
              réglages sans recréer la scène WebGL (aucun clignotement). La réaction au curseur reste active. */}
          <div className="absolute inset-0" aria-hidden>
            <CrystalizedBall
              preset={active ? ACTIVE_PRESET : IDLE_PRESET}
              theme="light"
              particleCount={BALL_PARTICLES}
              // Au repos : remplissage du preset ; en chargement : la progression.
              fill={active ? percent / 100 : undefined}
              intro={false}
            />
          </div>
          {active && <BallLabel text={text} finalizing={finalizing} />}
        </Suspense>
      ) : (
        svg
      )}
    </div>
  );
}

// Pourcentage par-dessus la boule. La poussière ne trace pas un niveau net (à 0 % elle tapisse déjà le fond) :
// le nombre écrit reste la vraie information. Halo blanc pour rester lisible sur les particules.
function BallLabel({ text, finalizing }: { text: string; finalizing: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "absolute inset-0 flex items-center justify-center font-semibold text-foreground",
        "[text-shadow:0_0_6px_white,0_0_12px_white]",
        finalizing ? "text-sm motion-safe:animate-pulse" : "text-3xl tabular-nums",
      )}
    >
      {text}
    </span>
  );
}

// Rendu de base : un cercle dont le « liquide » monte, dessiné en SVG. Sert de repli et d'attente de chargement.
function SvgBubble({ percent, text, finalizing }: { percent: number; text: string; finalizing: boolean }) {
  // Identifiants uniques : plusieurs bulles sur la même page ne doivent pas partager leurs découpes SVG.
  const id = useId();
  const bubbleClip = `${id}-bulle`;
  const liquidClip = `${id}-liquide`;
  const emptyClip = `${id}-vide`;
  // Le « liquide » est un carré de 100 × 100 décalé vers le bas : à 0 % il est entièrement sous la bulle, à 100 %
  // il la couvre. Décaler par transform (et non changer sa hauteur) permet une transition CSS fluide.
  const liquidOffset = { transform: `translateY(${100 - percent}px)` };
  // Partie vide : le même carré, décalé vers le haut, s'arrête exactement là où commence le liquide.
  const emptyOffset = { transform: `translateY(${-percent}px)` };
  // Transition courte et LINÉAIRE : la progression arrive par petits pas rapprochés (toutes les ~50 ms), et chaque
  // pas relance la transition. Avec 300 ms et une courbe qui ralentit, le liquide restait ~14 points derrière la
  // valeur affichée (mesuré dans Chrome) ; ainsi il ne la suit qu'à quelques points.
  const transition = "motion-safe:transition-transform motion-safe:duration-150 motion-safe:ease-linear";

  return (
    <svg viewBox="0 0 100 100" className="size-full" aria-hidden>
      <defs>
        <clipPath id={bubbleClip}>
          <circle cx="50" cy="50" r="48" />
        </clipPath>
        <clipPath id={liquidClip}>
          <rect width="100" height="100" style={liquidOffset} className={transition} />
        </clipPath>
        <clipPath id={emptyClip}>
          <rect width="100" height="100" style={emptyOffset} className={transition} />
        </clipPath>
      </defs>

      <g clipPath={`url(#${bubbleClip})`}>
        <rect width="100" height="100" className="fill-muted" />
        <rect width="100" height="100" style={liquidOffset} className={cn("fill-primary", transition)} />
      </g>
      <circle cx="50" cy="50" r="48" className="fill-none stroke-border" strokeWidth="1.5" />

      {/* Le texte est dessiné deux fois, chaque couche découpée à sa zone : sombre sur la partie vide, clair sur
          le liquide. Il reste lisible quel que soit le niveau, même quand la ligne de remplissage le traverse. */}
      {[
        { className: "fill-foreground", clipPath: `url(#${emptyClip})` },
        { className: "fill-primary-foreground", clipPath: `url(#${liquidClip})` },
      ].map((layer) => (
        <text
          key={layer.className}
          x="50"
          y="50"
          textAnchor="middle"
          dominantBaseline="central"
          clipPath={layer.clipPath}
          className={cn(
            layer.className,
            "font-semibold",
            finalizing ? "text-[11px] motion-safe:animate-pulse" : "text-[20px] tabular-nums",
          )}
        >
          {text}
        </text>
      ))}
    </svg>
  );
}
