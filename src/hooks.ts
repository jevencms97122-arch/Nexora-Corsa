import { createContext, useContext, useEffect, useState } from "react";
import type { Car, Track } from "./api";

export interface Content {
  cars: Car[];
  tracks: Track[];
  weathers: string[];
}

export const ContentContext = createContext<Content>({ cars: [], tracks: [], weathers: [] });
export const useContent = () => useContext(ContentContext);

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

/** Charge une image de façon asynchrone et ignore les réponses périmées. */
export function useImage(load: (() => Promise<string | null>) | null, deps: unknown[]): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    load?.()
      .then((s) => !cancelled && setSrc(s))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return src;
}
