import { open } from "@tauri-apps/plugin-dialog";
import { AnimatePresence, motion } from "motion/react";
import {
  Aperture,
  ArrowLeft,
  Check,
  ChevronRight,
  Download,
  FolderOpen,
  Gamepad2,
  Gauge,
  Keyboard,
  SlidersHorizontal,
  RefreshCw,
  Settings as SettingsIcon,
  Sparkles,
  User,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { Page } from "../App";
import { api, errorMessage, type AppConfig } from "../api";
import AssistsPicker from "../components/AssistsPicker";
import ControlsPanel from "../components/ControlsPanel";
import CspCard from "../components/CspCard";
import CspSettings from "../components/CspSettings";
import { useAssistPresets, type Notify } from "../hooks";
import Button from "../ui/Button";
import { Field } from "../ui/Fields";
import PageHeader, { CardTitle } from "../ui/PageHeader";
import type { Updater } from "../updater";

interface Props {
  config: AppConfig;
  onConfig: (c: AppConfig) => void;
  updater: Updater;
  notify: Notify;
  /** La page est affichée : on revient alors au menu des catégories. */
  active: boolean;
  go: (page: Page) => void;
}

type Section = "pilot" | "game" | "assists" | "graphics" | "csp" | "controls" | "updates";

const TILES: { id: Section; title: string; text: string; icon: ReactNode; tone: string; soon?: boolean }[] = [
  { id: "pilot", title: "Pilote", text: "Ton nom affiché en jeu et sur les serveurs.", icon: <User size={30} />, tone: "solo" },
  { id: "game", title: "Assetto Corsa", text: "Dossier d'installation du jeu.", icon: <Gamepad2 size={30} />, tone: "host" },
  { id: "assists", title: "Aides à la conduite", text: "Gamer, Intermédiaire ou Pro : ABS, antipatinage, ligne idéale, boîte auto…", icon: <Gauge size={30} />, tone: "join" },
  { id: "graphics", title: "Graphismes", text: "Profil de qualité, carte graphique, filtres d'image, ciel et météo, Custom Shaders Patch.", icon: <Aperture size={30} />, tone: "solo" },
  { id: "csp", title: "Custom Shaders Patch", text: "Tous les réglages du patch, module par module : ombres, herbe, reflets, caméras, interface…", icon: <SlidersHorizontal size={30} />, tone: "join" },
  { id: "controls", title: "Commandes", text: "Volant, manette ou clavier-souris : choix du périphérique et des touches.", icon: <Keyboard size={30} />, tone: "host" },
  { id: "updates", title: "Mises à jour", text: "Version de Nexora-Corsa et recherche de mises à jour.", icon: <Sparkles size={30} />, tone: "join" },
];

export default function Settings({ config, onConfig, updater, notify, active, go }: Props) {
  const [section, setSection] = useState<Section | null>(null);
  const [found, setFound] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const [name, setName] = useState(config.player_name);
  const [saved, setSaved] = useState(false);

  // Chaque ouverture des paramètres repart du menu.
  useEffect(() => {
    if (active) setSection(null);
  }, [active]);

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

  const presets = useAssistPresets();
  const assistsId = config.assists || "gamer";

  async function chooseAssists(id: string) {
    if (id === assistsId) return;
    try {
      onConfig(await api.setAssists(id));
      notify(`Aides « ${presets.find((p) => p.id === id)?.name ?? id} » : appliquées au prochain lancement.`);
    } catch (e) {
      notify(errorMessage(e), "error");
    }
  }

  async function saveName() {
    if (name.trim() === config.player_name) return;
    onConfig(await api.setPlayerName(name));
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  }

  const u = updater.state;
  const others = (found ?? []).filter((p) => p.toLowerCase() !== (config.ac_path ?? "").toLowerCase());
  const tile = TILES.find((t) => t.id === section);

  const views: Record<Section, ReactNode> = {
    pilot: (
      <section className="card">
        <CardTitle icon={<User size={16} />}>Pilote</CardTitle>
        <Field label="Nom affiché en jeu et sur les serveurs">
          <div className="row">
            <input
              className="input"
              value={name}
              maxLength={32}
              onChange={(e) => setName(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => e.key === "Enter" && saveName()}
            />
            <AnimatePresence>
              {saved && (
                <motion.span className="tag ok" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
                  <Check size={12} /> Enregistré
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        </Field>
      </section>
    ),

    game: (
      <section className="card stack">
        <CardTitle icon={<Gamepad2 size={16} />}>Assetto Corsa</CardTitle>
        <div className="notice ok" style={{ marginTop: 0 }}>
          <Check size={16} /> <span className="mono ellipsis">{config.ac_path}</span>
        </div>
        {others.map((p) => (
          <Button key={p} onClick={() => choose(p)} icon={<RefreshCw size={15} />}>
            Utiliser {p}
          </Button>
        ))}
        <Button variant="ghost" icon={<FolderOpen size={16} />} onClick={browse} style={{ alignSelf: "flex-start" }}>
          Changer de dossier…
        </Button>
        {error && <div className="notice danger">{error}</div>}
      </section>
    ),

    assists: (
      <section className="card stack">
        <CardTitle icon={<Gauge size={16} />}>Aides à la conduite</CardTitle>
        <p className="muted small" style={{ margin: "-6px 0 0" }}>
          Appliquées à chaque lancement d'une session, en solo comme en ligne. Les chiffres sont ceux des profils d'Assetto Corsa.
        </p>
        <AssistsPicker presets={presets} value={assistsId} onChange={chooseAssists} />
      </section>
    ),

    graphics: (
      <>
        <section className="card stack">
          <CardTitle icon={<Aperture size={16} />}>Graphismes</CardTitle>
          <p className="muted small" style={{ margin: "-6px 0 0" }}>
            Profils de qualité, carte graphique, filtres d'image, ciel et météo : tout se règle dans la page Graphismes.
          </p>
          <Button variant="primary" shine icon={<Aperture size={16} />} onClick={() => go("graphics")} style={{ alignSelf: "flex-start" }}>
            Ouvrir Graphismes
          </Button>
        </section>
        <CspCard variant="panel" notify={notify} />
      </>
    ),

    csp: <CspSettings notify={notify} />,
    controls: <ControlsPanel notify={notify} />,

    updates: (
      <section className="card stack">
        <CardTitle icon={<Sparkles size={16} />}>Mises à jour</CardTitle>
        <div className="row">
          <div className="grow">
            <div style={{ fontWeight: 600 }}>Nexora-Corsa {updater.version && `v${updater.version}`}</div>
            <div className="muted small">
              {u.phase === "uptodate" && "Tu as la dernière version."}
              {u.phase === "available" && `La version ${u.version} est disponible.`}
              {u.phase === "checking" && "Vérification en cours…"}
              {u.phase === "installing" && `Installation… ${u.percent ?? ""}${u.percent !== null ? " %" : ""}`}
              {u.phase === "error" && "Vérification impossible (aucune version publiée ou pas de connexion)."}
              {u.phase === "idle" && "Vérifiée automatiquement au démarrage."}
            </div>
          </div>
          {u.phase === "available" ? (
            <Button variant="primary" shine icon={<Download size={16} />} onClick={updater.install}>
              Installer
            </Button>
          ) : (
            <Button icon={<RefreshCw size={15} />} loading={u.phase === "checking" || u.phase === "installing"} onClick={updater.checkNow}>
              Vérifier
            </Button>
          )}
        </div>
      </section>
    ),
  };

  return (
    <div className="page" style={{ maxWidth: section === "csp" ? 1400 : 1100 }}>
      <AnimatePresence mode="wait" initial={false}>
        {section === null || !tile ? (
          <motion.div key="hub" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25 }}>
            <PageHeader eyebrow={<><SettingsIcon size={13} /> Préférences</>} title="Paramètres" subtitle="Choisis ce que tu veux régler." />
            <div className="settings-hub">
              {TILES.map((t, i) => (
                <motion.button
                  key={t.id}
                  className="settings-tile"
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                  whileHover={{ y: -4 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setSection(t.id)}
                >
                  <span className={`kind-dot big ${t.tone}`}>{t.icon}</span>
                  <span className="st-title">
                    {t.title}
                    {t.soon && <span className="tag">Bientôt</span>}
                  </span>
                  <span className="st-text">{t.text}</span>
                  <ChevronRight className="st-go" size={20} />
                </motion.button>
              ))}
            </div>
          </motion.div>
        ) : (
          <motion.div key={section} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.25 }}>
            <button className="back-link" onClick={() => setSection(null)}>
              <ArrowLeft size={16} /> Tous les paramètres
            </button>
            <PageHeader eyebrow={<><SettingsIcon size={13} /> Paramètres</>} title={tile.title} />
            <div className="stack">{views[section]}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
