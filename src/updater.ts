import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "./api";

export type UpdateState =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "uptodate" }
  | { phase: "available"; version: string }
  | { phase: "installing"; percent: number | null }
  | { phase: "error"; message: string };

const RECHECK_MS = 6 * 60 * 60 * 1000;

export function useUpdater() {
  const [state, setState] = useState<UpdateState>({ phase: "idle" });
  const [version, setVersion] = useState("");
  const update = useRef<Update | null>(null);

  const checkNow = useCallback(async (silent: boolean) => {
    setState({ phase: "checking" });
    try {
      const found = await check();
      update.current = found;
      setState(found ? { phase: "available", version: found.version } : { phase: "uptodate" });
    } catch (e) {
      // Hors ligne ou aucune version publiée : on ne dérange l'utilisateur que s'il a demandé la vérification.
      setState(silent ? { phase: "idle" } : { phase: "error", message: errorMessage(e) });
    }
  }, []);

  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
    checkNow(true);
    const timer = setInterval(() => checkNow(true), RECHECK_MS);
    return () => clearInterval(timer);
  }, [checkNow]);

  const install = useCallback(async () => {
    const u = update.current;
    if (!u) return;
    let total = 0;
    let done = 0;
    setState({ phase: "installing", percent: null });
    try {
      await u.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? 0;
        else if (event.event === "Progress") {
          done += event.data.chunkLength;
          setState({ phase: "installing", percent: total ? Math.round((done / total) * 100) : null });
        }
      });
      await relaunch();
    } catch (e) {
      setState({ phase: "error", message: errorMessage(e) });
    }
  }, []);

  return { state, version, checkNow: () => checkNow(false), install };
}

export type Updater = ReturnType<typeof useUpdater>;
