import { convertFileSrc } from "@tauri-apps/api/core";

/** Images lues directement dans le dossier du jeu (protocole asset de Tauri, autorisé sur `content`). */
const file = (...parts: string[]) => convertFileSrc(parts.join("\\"));

export function carPreview(ac: string, car: string, skin: string): string[] {
  const dir = [ac, "content", "cars", car, "skins", skin];
  return [file(...dir, "preview.jpg"), file(...dir, "preview.png")];
}

export function carBadge(ac: string, car: string): string[] {
  return [file(ac, "content", "cars", car, "ui", "badge.png")];
}

export function skinSwatch(ac: string, car: string, skin: string): string[] {
  const dir = [ac, "content", "cars", car, "skins", skin];
  return [file(...dir, "livery.png"), file(...dir, "preview.jpg")];
}

export function trackPreview(ac: string, track: string, layout: string): string[] {
  const dir = layout ? [ac, "content", "tracks", track, "ui", layout] : [ac, "content", "tracks", track, "ui"];
  return [file(...dir, "preview.png"), file(...dir, "preview.jpg")];
}

export function trackOutline(ac: string, track: string, layout: string): string[] {
  const dir = layout ? [ac, "content", "tracks", track, "ui", layout] : [ac, "content", "tracks", track, "ui"];
  return [file(...dir, "outline.png")];
}

/** "4909" → "4,9 km" ; laisse tel quel ce qui contient déjà une unité. */
export function formatLength(raw: string): string {
  const n = Number(raw.replace(",", "."));
  if (!raw || Number.isNaN(n)) return raw;
  return n > 100 ? `${(n / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km` : `${n} km`;
}
