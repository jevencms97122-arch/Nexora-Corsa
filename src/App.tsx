import { useCallback, useEffect, useState } from "react";
import { api, errorMessage, type AppConfig } from "./api";
import { ContentContext, type Content } from "./hooks";
import { useUpdater } from "./updater";
import GameSetup from "./pages/GameSetup";
import History from "./pages/History";
import Mods from "./pages/Mods";
import Online from "./pages/Online";
import Solo from "./pages/Solo";
import "./styles.css";

type Page = "solo" | "online" | "mods" | "history" | "settings";
type Toast = { msg: string; kind: "ok" | "error" } | null;

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [content, setContent] = useState<Content | null>(null);
  const [loadError, setLoadError] = useState("");
  const [page, setPage] = useState<Page>("solo");
  const [toast, setToast] = useState<Toast>(null);
  const updater = useUpdater();

  const notify = useCallback((msg: string, kind: "ok" | "error" = "ok") => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 4500);
  }, []);

  useEffect(() => {
    api.getConfig().then(setConfig);
  }, []);

  const loadContent = useCallback(() => {
    return Promise.all([api.listCars(), api.listTracks(), api.listWeathers()])
      .then(([cars, tracks, weathers]) => setContent({ cars, tracks, weathers }))
      .catch((e) => setLoadError(errorMessage(e)));
  }, []);

  // Recharge le contenu du jeu à chaque changement de dossier.
  useEffect(() => {
    if (!config?.ac_path) return;
    setContent(null);
    setLoadError("");
    loadContent();
  }, [config?.ac_path, loadContent]);

  if (!config) return null;
  if (!config.ac_path) return <GameSetup config={config} onConfig={setConfig} updater={updater} firstRun />;

  const playerName = config.player_name || "Pilote";
  const nav: [Page, string][] = [
    ["solo", "Solo"],
    ["online", "En ligne"],
    ["mods", "Mods"],
    ["history", "Historique"],
    ["settings", "Paramètres"],
  ];

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="logo">
          NEXORA<span>·CORSA</span>
        </div>
        {nav.map(([id, label]) => (
          <button key={id} className={page === id ? "active" : ""} onClick={() => setPage(id)}>
            {label}
          </button>
        ))}
        <div className="grow" />
        {updater.state.phase === "available" && (
          <button className="update-btn" onClick={updater.install}>
            ⬆ Mettre à jour vers {updater.state.version}
          </button>
        )}
        {updater.state.phase === "installing" && (
          <div className="muted small pad">
            Mise à jour… {updater.state.percent !== null ? `${updater.state.percent} %` : ""}
          </div>
        )}
        <div className="muted small pad">Pilote : {playerName}</div>
      </aside>
      <main className="main">
        {page === "settings" ? (
          <GameSetup config={config} onConfig={setConfig} updater={updater} />
        ) : loadError ? (
          <div className="page">
            <p className="error">{loadError}</p>
          </div>
        ) : !content ? (
          <div className="page muted">Lecture du contenu du jeu…</div>
        ) : (
          <ContentContext.Provider value={content}>
            {/* Les deux onglets restent montés : le serveur et ses réglages survivent au changement de page. */}
            <div hidden={page !== "solo"}>
              <Solo playerName={playerName} notify={notify} />
            </div>
            <div hidden={page !== "online"}>
              <Online playerName={playerName} notify={notify} />
            </div>
            {page === "mods" && <Mods notify={notify} onContentChanged={loadContent} />}
            {page === "history" && <History notify={notify} />}
          </ContentContext.Provider>
        )}
      </main>
      {toast && <div className={`toast ${toast.kind}`}>{toast.msg}</div>}
    </div>
  );
}
