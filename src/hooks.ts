import { createContext, useContext, useEffect, useState } from "react";
import { api, type AssistPreset, type Car, type Track } from "./api";

export interface Content {
  /** Dossier du jeu, pour construire les chemins des images. */
  acPath: string;
  cars: Car[];
  tracks: Track[];
  weathers: string[];
}

export const ContentContext = createContext<Content>({ acPath: "", cars: [], tracks: [], weathers: [] });
export const useContent = () => useContext(ContentContext);

export type Notify = (msg: string, kind?: "ok" | "error") => void;

let presetsCache: Promise<AssistPreset[]> | null = null;

/** Profils d'aides à la conduite (chargés une seule fois pour toute l'application). */
export function useAssistPresets(): AssistPreset[] {
  const [presets, setPresets] = useState<AssistPreset[]>([]);
  useEffect(() => {
    presetsCache ??= api.assistPresets();
    presetsCache.then(setPresets).catch(() => {
      presetsCache = null;
    });
  }, []);
  return presets;
}

/** État persisté dans localStorage (préférences du joueur). */
export function usePersisted<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? { ...initial, ...JSON.parse(raw) } : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* stockage indisponible : on ignore */
    }
  }, [key, value]);
  return [value, setValue];
}
