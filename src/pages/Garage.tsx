import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { AnimatePresence, motion } from "motion/react";
import { ExternalLink, Globe, House, Lock, PackageOpen, RotateCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const GARAGE_URL = "https://www.assettoworld.com/";
const MAX_TABS = 12;

interface Tab {
  id: number;
  url: string;
  /** Change pour recharger le cadre. */
  nonce: number;
  loading: boolean;
}

interface Props {
  /** Passe sur l'onglet Mods. */
  goToMods: () => void;
}

/** Libellé court d'un onglet : le domaine, suivi du début du chemin. */
function tabLabel(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const path = u.pathname.replace(/\/$/, "");
    return path ? `${host}${path}` : host;
  } catch {
    return url;
  }
}

/** Le Garage : le site AssettoWorld dans un mini-navigateur à onglets. */
export default function Garage({ goToMods }: Props) {
  const nextId = useRef(1);
  const [tabs, setTabs] = useState<Tab[]>([{ id: 0, url: GARAGE_URL, nonce: 0, loading: true }]);
  const tabCount = useRef(1);
  tabCount.current = tabs.length;
  const [active, setActive] = useState(0);

  // Les nouvelles fenêtres demandées par le site (target=_blank, window.open) arrivent ici.
  useEffect(() => {
    const un = listen<string>("garage-new-tab", (e) => {
      if (tabCount.current >= MAX_TABS) return;
      // L'identifiant est choisi ici et non dans la fonction de mise à jour : React peut l'exécuter deux fois.
      const id = nextId.current++;
      tabCount.current += 1;
      setTabs((current) => [...current, { id, url: e.payload, nonce: 0, loading: true }]);
      setActive(id);
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  const patch = (id: number, changes: Partial<Tab>) => setTabs((list) => list.map((t) => (t.id === id ? { ...t, ...changes } : t)));

  function close(id: number) {
    const index = tabs.findIndex((t) => t.id === id);
    const remaining = tabs.filter((t) => t.id !== id);
    setTabs(remaining);
    if (active === id) setActive(remaining[Math.max(0, index - 1)].id);
  }

  const current = tabs.find((t) => t.id === active) ?? tabs[0];
  const reload = () => patch(current.id, { nonce: current.nonce + 1, loading: true });
  const home = () => patch(0, { url: GARAGE_URL, nonce: tabs[0].nonce + 1, loading: true });

  return (
    <div className="garage">
      <div className="garage-top">
        <div className="browser-tabs">
          <AnimatePresence initial={false}>
            {tabs.map((t) => (
              <motion.div
                key={t.id}
                layout
                className={`browser-tab ${t.id === active ? "active" : ""}`}
                initial={{ opacity: 0, y: 12, width: 0 }}
                animate={{ opacity: 1, y: 0, width: "auto" }}
                exit={{ opacity: 0, y: 12, width: 0, minWidth: 0, paddingLeft: 0, paddingRight: 0 }}
                transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                onClick={() => setActive(t.id)}
                title={t.url}
              >
                {t.loading ? <span className="spinner" style={{ width: 14, height: 14, borderTopColor: "var(--accent-2)" }} /> : <Globe size={14} className="favicon" />}
                <span className="grow ellipsis">{t.id === 0 ? "AssettoWorld" : tabLabel(t.url)}</span>
                {t.id !== 0 && (
                  <button
                    className="close"
                    title="Fermer l'onglet"
                    onClick={(e) => {
                      e.stopPropagation();
                      close(t.id);
                    }}
                  >
                    <X size={13} />
                  </button>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
      <div className="garage-bar">
        <button className="icon-btn" title="Accueil d'AssettoWorld" onClick={() => { setActive(0); home(); }}>
          <House size={16} />
        </button>
        <button className="icon-btn" title="Recharger" onClick={reload}>
          <RotateCw size={16} />
        </button>
        <div className="address">
          <Lock size={13} />
          <span className="ellipsis">{current.url}</span>
        </div>
        <button className="btn sm" onClick={goToMods}>
          <PackageOpen size={14} /> Mes mods
        </button>
        <button className="icon-btn" title="Ouvrir dans le navigateur" onClick={() => openUrl(current.url)}>
          <ExternalLink size={16} />
        </button>
      </div>
      <div className="garage-frames">
        {current.loading && <div className="frame-loader" />}
        {/* Tous les onglets restent montés pour garder leur page ; seul l'actif est visible. */}
        {tabs.map((t) => (
          <iframe
            key={`${t.id}-${t.nonce}`}
            className="garage-frame"
            hidden={t.id !== active}
            src={t.url}
            title={t.id === 0 ? "AssettoWorld" : t.url}
            allow="fullscreen; clipboard-write"
            referrerPolicy="strict-origin-when-cross-origin"
            onLoad={() => patch(t.id, { loading: false })}
          />
        ))}
      </div>
    </div>
  );
}
