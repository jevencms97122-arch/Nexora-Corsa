import { AnimatePresence, motion, MotionConfig } from "motion/react";
import {
  AlertCircle,
  Aperture,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Flag,
  Globe,
  History as HistoryIcon,
  House,
  Package,
  Settings as SettingsIcon,
  Sparkles,
  Store,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api, errorMessage, type AppConfig } from "./api";
import DownloadPrompt from "./components/DownloadPrompt";
import { ContentContext, usePersisted, type Content } from "./hooks";
import Garage from "./pages/Garage";
import Graphics from "./pages/Graphics";
import History from "./pages/History";
import Home from "./pages/Home";
import Mods from "./pages/Mods";
import Onboarding from "./pages/Onboarding";
import Online, { type OnlineTab } from "./pages/Online";
import Settings from "./pages/Settings";
import Solo from "./pages/Solo";
import "./styles.css";
import Logo from "./ui/Logo";
import { useUpdater } from "./updater";

export type Page = "home" | "solo" | "online" | "garage" | "mods" | "graphics" | "history" | "settings";
type Toast = { id: number; msg: string; kind: "ok" | "error" };

const TOAST_MS = 4500;

const NAV: { section: string; items: { id: Page; label: string; icon: ReactNode }[] }[] = [
  {
    section: "Jouer",
    items: [
      { id: "home", label: "Accueil", icon: <House size={18} /> },
      { id: "solo", label: "Solo", icon: <Flag size={18} /> },
      { id: "online", label: "En ligne", icon: <Globe size={18} /> },
    ],
  },
  {
    section: "Contenu",
    items: [
      { id: "garage", label: "Garage", icon: <Store size={18} /> },
      { id: "mods", label: "Mods", icon: <Package size={18} /> },
      { id: "graphics", label: "Graphismes", icon: <Aperture size={18} /> },
      { id: "history", label: "Historique", icon: <HistoryIcon size={18} /> },
    ],
  },
];

function Backdrop() {
  return (
    <div className="backdrop" aria-hidden>
      <div className="glow a" />
      <div className="glow b" />
      <div className="grid" />
    </div>
  );
}

/** Page conservée en mémoire : elle s'efface en fondu au lieu d'être démontée, pour garder son état. */
function PageView({ active, fill, children }: { active: boolean; fill?: boolean; children: ReactNode }) {
  return (
    <motion.div
      className={`page-view ${fill ? "fill" : ""}`}
      initial={false}
      animate={active ? { opacity: 1, y: 0, display: "block" } : { opacity: 0, y: 10, transitionEnd: { display: "none" } }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      style={{ pointerEvents: active ? "auto" : "none" }}
    >
      {children}
    </motion.div>
  );
}

function LoadingContent() {
  return (
    <div className="page">
      <div className="skeleton" style={{ height: 300, borderRadius: 22, marginBottom: 22 }} />
      <div className="quick-grid">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton" style={{ height: 120, borderRadius: 16 }} />
        ))}
      </div>
      <p className="muted center">Lecture des voitures et des circuits…</p>
    </div>
  );
}

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [content, setContent] = useState<Content | null>(null);
  const [loadError, setLoadError] = useState("");
  const [page, setPage] = useState<Page>("home");
  const [onlineTab, setOnlineTab] = useState<OnlineTab>("host");
  const [visited, setVisited] = useState<Set<Page>>(() => new Set(["home"]));
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [serverRunning, setServerRunning] = useState(false);
  const toastId = useRef(0);
  const updater = useUpdater();
  const [ui, setUi] = usePersisted("nexora.ui", { collapsed: false });
  const compact = ui.collapsed || page === "garage";

  const notify = useCallback((msg: string, kind: "ok" | "error" = "ok") => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-3), { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), TOAST_MS);
  }, []);

  const go = useCallback((p: Page, tab?: OnlineTab) => {
    if (tab) setOnlineTab(tab);
    setPage(p);
    setVisited((v) => (v.has(p) ? v : new Set(v).add(p)));
  }, []);

  useEffect(() => {
    api.getConfig().then(setConfig);
  }, []);

  // Indicateur « serveur en ligne » dans la barre latérale.
  useEffect(() => {
    const poll = () => api.serverStatus().then((s) => setServerRunning(s.running)).catch(() => {});
    poll();
    const timer = setInterval(poll, 4000);
    return () => clearInterval(timer);
  }, []);

  const loadContent = useCallback(() => {
    return Promise.all([api.getConfig(), api.listCars(), api.listTracks(), api.listWeathers()])
      .then(([cfg, cars, tracks, weathers]) => setContent({ acPath: cfg.ac_path ?? "", cars, tracks, weathers }))
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

  const playerName = config.player_name || "Pilote";
  const shown = (p: Page) => visited.has(p);

  return (
    <MotionConfig reducedMotion="user">
      <Backdrop />
      {!config.ac_path ? (
        <Onboarding config={config} onDone={setConfig} />
      ) : (
        // Le Garage replie toujours la barre : le site affiché passe en mise en page mobile sous 992 px.
        <div className={`shell ${compact ? "compact" : ""}`}>
          <aside className="sidebar">
            {page !== "garage" && (
              <button
                className="collapse-btn"
                title={ui.collapsed ? "Déplier le menu" : "Replier le menu"}
                onClick={() => setUi({ collapsed: !ui.collapsed })}
              >
                {ui.collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
              </button>
            )}
            <div className="brand">
              <div className="brand-mark">
                <Logo size={20} />
              </div>
              <div className="brand-name">
                NEXORA<span>CORSA</span>
              </div>
            </div>
            {NAV.map((group) => (
              <div key={group.section}>
                <div className="nav-label">{group.section}</div>
                {group.items.map((item) => (
                  <NavButton key={item.id} active={page === item.id} icon={item.icon} label={item.label} onClick={() => go(item.id)}>
                    {item.id === "online" && serverRunning && <span className="nav-badge" title="Serveur en ligne" />}
                  </NavButton>
                ))}
              </div>
            ))}
            <div className="sidebar-foot">
              <AnimatePresence>
                {(updater.state.phase === "available" || updater.state.phase === "installing") && (
                  <motion.button
                    className="update-cta"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    onClick={updater.install}
                    disabled={updater.state.phase === "installing"}
                  >
                    <Sparkles size={16} />
                    <span className="nav-text">
                      {updater.state.phase === "available"
                        ? `Mettre à jour (${updater.state.version})`
                        : `Mise à jour… ${updater.state.percent ?? ""}${updater.state.percent !== null ? " %" : ""}`}
                    </span>
                  </motion.button>
                )}
              </AnimatePresence>
              <NavButton active={page === "settings"} icon={<SettingsIcon size={18} />} label="Paramètres" onClick={() => go("settings")} />
              <div className="pilot" title={playerName}>
                <div className="avatar">{playerName.slice(0, 1).toUpperCase()}</div>
                <div className="grow">
                  <div className="ellipsis" style={{ fontWeight: 600, fontSize: 13.5 }}>{playerName}</div>
                  <div className="muted tiny">{updater.version ? `v${updater.version}` : "Pilote"}</div>
                </div>
              </div>
            </div>
          </aside>

          <main className="main">
            {loadError ? (
              <div className="page">
                <div className="notice danger">
                  <AlertCircle size={16} /> {loadError}
                </div>
              </div>
            ) : !content ? (
              <LoadingContent />
            ) : (
              <ContentContext.Provider value={content}>
                <PageView active={page === "home"}>
                  <Home active={page === "home"} playerName={playerName} notify={notify} go={go} />
                </PageView>
                {shown("solo") && (
                  <PageView active={page === "solo"}>
                    <Solo playerName={playerName} assists={config.assists} notify={notify} onOpenSettings={() => go("settings")} />
                  </PageView>
                )}
                {shown("online") && (
                  <PageView active={page === "online"}>
                    <Online playerName={playerName} notify={notify} tab={onlineTab} onTab={setOnlineTab} />
                  </PageView>
                )}
                {shown("garage") && (
                  <PageView active={page === "garage"} fill>
                    <Garage goToMods={() => go("mods")} />
                  </PageView>
                )}
                {shown("mods") && (
                  <PageView active={page === "mods"}>
                    <Mods active={page === "mods"} notify={notify} onContentChanged={loadContent} />
                  </PageView>
                )}
                {shown("graphics") && (
                  <PageView active={page === "graphics"}>
                    <Graphics active={page === "graphics"} notify={notify} go={go} />
                  </PageView>
                )}
                {shown("history") && (
                  <PageView active={page === "history"}>
                    <History active={page === "history"} notify={notify} />
                  </PageView>
                )}
                {shown("settings") && (
                  <PageView active={page === "settings"}>
                    <Settings config={config} onConfig={setConfig} updater={updater} notify={notify} active={page === "settings"} go={go} />
                  </PageView>
                )}
              </ContentContext.Provider>
            )}
          </main>
          <DownloadPrompt onContentChanged={loadContent} />
        </div>
      )}
      <div className="toasts">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              className={`toast ${t.kind}`}
              initial={{ opacity: 0, x: 40, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40, scale: 0.95 }}
              transition={{ type: "spring", stiffness: 380, damping: 30 }}
            >
              <span className="t-icon">{t.kind === "ok" ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}</span>
              <span className="t-body">{t.msg}</span>
              <span className="t-timer" style={{ width: "100%", animationDuration: `${TOAST_MS}ms` }} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}

function NavButton({
  active,
  icon,
  label,
  onClick,
  children,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
  children?: ReactNode;
}) {
  return (
    <button className={`nav-item ${active ? "active" : ""}`} onClick={onClick} title={label}>
      {active && <motion.span layoutId="nav-pill" className="nav-pill" transition={{ type: "spring", stiffness: 420, damping: 36 }} />}
      <span className="nav-icon">{icon}</span>
      <span className="nav-text">{label}</span>
      {children}
    </button>
  );
}
