import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { api, errorMessage, type AppConfig } from "../api";
import type { Updater } from "../updater";

interface Props {
  config: AppConfig;
  onConfig: (c: AppConfig) => void;
  updater: Updater;
  /** Première configuration : présentation plein écran. */
  firstRun?: boolean;
}

/** Choix du dossier d'Assetto Corsa : détection automatique ou sélection manuelle. */
export default function GameSetup({ config, onConfig, updater, firstRun }: Props) {
  const [found, setFound] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const [name, setName] = useState(config.player_name);

  useEffect(() => {
    api.detectGame().then(setFound).catch(() => setFound([]));
  }, []);

  async function choose(path: string) {
    try {
      onConfig(await api.setAcPath(path));
      setError("");
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function browse() {
    const dir = await open({ directory: true, title: "Dossier d'installation d'Assetto Corsa" });
    if (typeof dir === "string") await choose(dir);
  }

  async function saveName() {
    onConfig(await api.setPlayerName(name));
  }

  return (
    <div className={firstRun ? "welcome" : "page"}>
      <div className="card setup">
        {firstRun ? (
          <>
            <h1>Bienvenue sur Nexora-Corsa</h1>
            <p className="muted">Indique où Assetto Corsa est installé pour commencer.</p>
          </>
        ) : (
          <h1>Paramètres</h1>
        )}

        <h2>Pseudo</h2>
        <div className="row">
          <input className="input" placeholder="Ton nom de pilote" value={name} onChange={(e) => setName(e.target.value)} onBlur={saveName} />
        </div>

        <h2>Dossier du jeu</h2>
        {config.ac_path && (
          <p>
            Actuel : <code>{config.ac_path}</code>
          </p>
        )}
        {found === null && <p className="muted">Recherche d'Assetto Corsa…</p>}
        {found?.map((p) => (
          <button key={p} className="btn primary" onClick={() => choose(p)}>
            Utiliser {p}
          </button>
        ))}
        {found?.length === 0 && <p className="muted">Installation Steam non trouvée automatiquement.</p>}
        <button className="btn" onClick={browse}>
          📁 Choisir le dossier manuellement…
        </button>
        {error && <p className="error">{error}</p>}

        {!firstRun && (
          <>
            <h2>Mises à jour</h2>
            <p className="muted">
              Version installée : <b>{updater.version || "?"}</b>
              {updater.state.phase === "uptodate" && " — à jour"}
              {updater.state.phase === "available" && ` — version ${updater.state.version} disponible`}
              {updater.state.phase === "checking" && " — vérification…"}
            </p>
            {updater.state.phase === "available" ? (
              <button className="btn primary" onClick={updater.install}>
                Installer la mise à jour
              </button>
            ) : (
              <button className="btn" disabled={updater.state.phase === "checking"} onClick={updater.checkNow}>
                Vérifier les mises à jour
              </button>
            )}
            {updater.state.phase === "error" && (
              <p className="error small">Vérification impossible (aucune version publiée ou pas de connexion).</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
