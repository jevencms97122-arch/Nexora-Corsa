import { CarFront, CloudSun, Map, Sparkles, Wand2 } from "lucide-react";
import type { ModInfo } from "../api";

type Kind = ModInfo["kind"];

export const KIND_LABEL: Record<Kind, string> = {
  car: "Voiture",
  track: "Circuit",
  csp: "Patch",
  weather: "Ciel et météo",
  filter: "Filtre d'image",
};

/** Teinte de la pastille d'un type de contenu (classes `kind-dot.*`). */
export const KIND_TONE: Record<Kind, string> = { car: "solo", track: "host", csp: "join", weather: "join", filter: "solo" };

export function KindIcon({ kind, size = 15, color }: { kind: Kind; size?: number; color?: string }) {
  const props = { size, color };
  switch (kind) {
    case "car":
      return <CarFront {...props} />;
    case "track":
      return <Map {...props} />;
    case "weather":
      return <CloudSun {...props} />;
    case "filter":
      return <Wand2 {...props} />;
    default:
      return <Sparkles {...props} />;
  }
}

/** Nom affiché d'un contenu détecté : Custom Shaders Patch n'a pas d'identifiant parlant. */
export function kindName(kind: Kind, id: string): string {
  return kind === "csp" ? "Custom Shaders Patch" : id;
}

const STOCK_WEATHER = ["1_heavy_fog", "2_light_fog", "3_clear", "4_mid_clear", "5_light_clouds", "6_mid_clouds", "7_heavy_clouds"];

/**
 * Ce qu'un mod de ciel va écraser dans le jeu (il remplace parfois les réglages météo d'origine) ; `null` s'il n'écrase rien.
 * Les fichiers remplacés sont sauvegardés avant l'installation.
 */
export function replaceNote(infos: ModInfo[]): string | null {
  const paths = infos.flatMap((i) => i.replaces ?? []);
  if (paths.length === 0) return null;
  const names = paths.map((p) => p.split("/").pop() ?? p);
  const stock = names.filter((n) => STOCK_WEATHER.includes(n.toLowerCase())).length;
  const shown = names.slice(0, 6).join(", ") + (names.length > 6 ? `… (+${names.length - 6})` : "");
  return (
    `Écrase des fichiers existants dans ${names.length} dossier${names.length > 1 ? "s" : ""} : ${shown}` +
    (stock > 0 ? ` (dont ${stock} réglage${stock > 1 ? "s" : ""} météo d'origine du jeu)` : "") +
    ". Les anciens fichiers sont d'abord sauvegardés."
  );
}

/** Explication de ce que l'installation va faire, pour les contenus qui touchent au dossier du jeu. */
export function kindNote(kind: Kind): string | null {
  switch (kind) {
    case "csp":
      return "Copie dwrite.dll dans le dossier du jeu (chargé à chaque lancement). N'installe que un fichier dont tu connais la source.";
    case "weather":
      return "Seuls les dossiers de météo sont copiés dans le jeu (content/weather et extension) : le reste de l'archive est ignoré.";
    case "filter":
      return "Le filtre est copié dans le dossier du jeu (system/cfg/ppfilters) ; choisis-le ensuite dans Graphismes.";
    default:
      return null;
  }
}
