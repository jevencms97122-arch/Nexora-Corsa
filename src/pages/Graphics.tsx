import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle,
  Aperture,
  Check,
  CloudSun,
  Cpu,
  FolderPlus,
  ImagePlus,
  RotateCcw,
  Sparkles,
  Store,
  Wand2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage, type FilterInfo, type GpuInfo, type GraphicsState, type WeatherOptions } from "../api";
import type { Page } from "../App";
import type { Notify } from "../hooks";
import Button from "../ui/Button";
import { Field, Switch } from "../ui/Fields";
import { Item, Stagger } from "../ui/motion";
import PageHeader, { CardTitle } from "../ui/PageHeader";

interface Props {
  active: boolean;
  notify: Notify;
  go: (page: Page) => void;
}

const FILTER_NAMES: Record<string, string> = {
  "b&w": "Noir et blanc",
  blue_steel: "Acier bleuté",
  default: "Par défaut",
  default_bright: "Clair",
  default_dark: "Sombre",
  movie: "Cinéma",
  natural: "Naturel",
  photographic: "Photographique",
  sepia: "Sépia",
  vintage: "Vintage",
};

function filterLabel(id: string): string {
  const known = FILTER_NAMES[id.toLowerCase()];
  if (known) return known;
  const text = id.replace(/[_-]+/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export default function Graphics({ active, notify, go }: Props) {
  const [gfx, setGfx] = useState<GraphicsState | null>(null);
  const [filters, setFilters] = useState<FilterInfo[] | null>(null);
  const [weather, setWeather] = useState<WeatherOptions | null>(null);
  const [gpu, setGpu] = useState<GpuInfo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);

  const refresh = useCallback(() => {
    api.graphicsState().then(setGfx).catch(() => {});
    api.listFilters().then(setFilters).catch(() => setFilters([]));
    api.weatherOptions().then(setWeather).catch(() => {});
    api.gpuInfo().then(setGpu).catch(() => {});
  }, []);

  // Rechargé à chaque affichage : on revient souvent de l'onglet Mods après avoir installé un filtre ou un ciel.
  useEffect(() => {
    if (active) refresh();
  }, [active, refresh]);

  async function run<T>(key: string, job: () => Promise<T>, done: (r: T) => void, message: string) {
    setBusy(key);
    try {
      done(await job());
      notify(message);
    } catch (e) {
      notify(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  }

  const applyProfile = (id: string, name: string) =>
    run(`profile-${id}`, () => api.applyGraphicsProfile(id), setGfx, `Profil « ${name} » appliqué : visible au prochain lancement du jeu.`);

  const restore = () =>
    run("restore", () => api.restoreGraphics(), (s) => {
      setGfx(s);
      setConfirmRestore(false);
      api.listFilters().then(setFilters).catch(() => {});
      api.weatherOptions().then(setWeather).catch(() => {});
    }, "Réglages d'origine restaurés.");

  const chooseFilter = (id: string) =>
    run(`filter-${id}`, () => api.setFilter(id), (list) => {
      setFilters(list);
      api.graphicsState().then(setGfx).catch(() => {});
    }, `Filtre « ${filterLabel(id)} » sélectionné.`);

  const chooseWeather = (controller: string, implementation: string) =>
    run("weather", () => api.setWeather(controller, implementation), setWeather, "Réglages du ciel enregistrés.");

  const toggleGpu = (high: boolean) =>
    run("gpu", () => api.setGpuPreference(high), setGpu, high ? "Carte performante activée pour le jeu." : "Réglage de Windows rétabli pour le jeu.");

  const added = weather?.presets.filter((p) => !p.builtin).length ?? 0;
  const dedicatedAdapters = gpu?.adapters ?? [];
  const mixedGpus = !!gpu && gpu.has_discrete && gpu.has_integrated;

  return (
    <div className="page" style={{ maxWidth: 1250 }}>
      <PageHeader
        eyebrow={<><Aperture size={13} /> Rendu</>}
        title="Graphismes"
        subtitle="Profils de qualité, carte graphique, filtres d'image et ciel : tout ce qui rend le jeu plus beau."
      />
      <Stagger className="stack" >
        {/* ------------------------------------------------------------------ Profils */}
        <Item>
          <section className="card stack">
            <CardTitle
              icon={<Sparkles size={16} />}
              right={gfx && !gfx.active && gfx.has_backup ? <span className="tag">Personnalisé</span> : undefined}
            >
              Profils de qualité
            </CardTitle>
            <p className="muted small" style={{ margin: "-6px 0 0" }}>
              Un clic règle la vidéo du jeu et les effets de Custom Shaders Patch. Tout est écrit dans tes Documents (Assetto Corsa → cfg), jamais dans
              le dossier du jeu, et tes réglages actuels sont sauvegardés avant la première modification.
            </p>
            {gfx && !gfx.csp_installed && (
              <div className="notice warn" style={{ marginTop: 0 }}>
                <AlertTriangle size={16} />
                <span>
                  Custom Shaders Patch n'est pas installé : seuls les réglages vidéo du jeu seront appliqués, sans les effets avancés.{" "}
                  <button className="link-btn" onClick={() => go("settings")}>
                    Installer Custom Shaders Patch
                  </button>
                </span>
              </div>
            )}
            {!gfx ? (
              <div className="assist-grid four">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="skeleton" style={{ height: 420, borderRadius: 16 }} />
                ))}
              </div>
            ) : (
              <div className="assist-grid four" role="radiogroup" aria-label="Profil de qualité">
                {gfx.profiles.map((p, i) => {
                  const on = gfx.active === p.id;
                  const working = busy === `profile-${p.id}`;
                  return (
                    <motion.button
                      key={p.id}
                      role="radio"
                      aria-checked={on}
                      disabled={busy !== null}
                      className={`assist-card ${on ? "selected" : ""}`}
                      initial={{ opacity: 0, y: 14 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.06, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                      whileTap={{ scale: 0.985 }}
                      onClick={() => applyProfile(p.id, p.name)}
                    >
                      <div className="assist-head">
                        <div>
                          <div className="assist-name">{p.name}</div>
                          <div className="muted tiny">{p.tagline}</div>
                        </div>
                        <span className="assist-check">
                          {working ? (
                            <span className="spinner" style={{ width: 13, height: 13 }} />
                          ) : (
                            <motion.span initial={false} animate={{ scale: on ? 1 : 0, opacity: on ? 1 : 0 }} transition={{ type: "spring", stiffness: 500, damping: 26 }}>
                              <Check size={15} strokeWidth={3} />
                            </motion.span>
                          )}
                        </span>
                      </div>
                      <div className="assist-rows">
                        {p.highlights.map((h) => (
                          <div key={h.label} className="assist-row">
                            <span>{h.label}</span>
                            <b className={h.value === "Non" ? "tone-off" : "tone-on"}>{h.value}</b>
                          </div>
                        ))}
                      </div>
                    </motion.button>
                  );
                })}
              </div>
            )}
            {gfx?.has_backup && (
              <div className="row wrap">
                <AnimatePresence mode="wait" initial={false}>
                  {confirmRestore ? (
                    <motion.div key="c" className="row" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
                      <span className="small">Revenir à tes réglages d'avant Nexora-Corsa ?</span>
                      <Button size="sm" variant="danger" loading={busy === "restore"} onClick={restore}>
                        Oui, restaurer
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmRestore(false)}>
                        Annuler
                      </Button>
                    </motion.div>
                  ) : (
                    <motion.div key="b" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      <Button size="sm" variant="ghost" icon={<RotateCcw size={14} />} onClick={() => setConfirmRestore(true)}>
                        Restaurer mes réglages d'origine
                      </Button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </section>
        </Item>

        {/* ------------------------------------------------------------------ Carte graphique */}
        <Item>
          <section className="card stack">
            <CardTitle icon={<Cpu size={16} />}>Carte graphique</CardTitle>
            {!gpu ? (
              <div className="skeleton" style={{ height: 70 }} />
            ) : (
              <>
                <div className="row wrap">
                  {dedicatedAdapters.length === 0 && <span className="muted small">Aucune carte détectée.</span>}
                  {dedicatedAdapters.map((a) => (
                    <span key={a} className="tag">
                      <Cpu size={12} /> {a}
                    </span>
                  ))}
                </div>
                {mixedGpus && !gpu.forced && (
                  <div className="notice warn" style={{ marginTop: 0 }}>
                    <AlertTriangle size={16} /> Ton PC a une puce intégrée et une carte dédiée : sans réglage, Windows peut lancer le jeu sur la puce intégrée,
                    bien moins puissante.
                  </div>
                )}
                <Switch
                  label="Utiliser la carte graphique performante pour Assetto Corsa"
                  hint={
                    gpu.has_discrete
                      ? "Réglage « Haute performance » de Windows, pour le jeu et son lanceur. Pris en compte au prochain lancement."
                      : "Aucune carte dédiée détectée : ce réglage ne changerait rien."
                  }
                  checked={gpu.forced}
                  onChange={(v) => busy === null && gpu.has_discrete && toggleGpu(v)}
                />
              </>
            )}
          </section>
        </Item>

        {/* ------------------------------------------------------------------ Filtres */}
        <Item>
          <section className="card stack">
            <CardTitle
              icon={<Wand2 size={16} />}
              right={
                <Button size="sm" icon={<ImagePlus size={14} />} onClick={() => go("mods")}>
                  Installer un filtre
                </Button>
              }
            >
              Filtres d'image
            </CardTitle>
            <p className="muted small" style={{ margin: "-6px 0 0" }}>
              Le filtre change les couleurs et le contraste de toute l'image. Pour en ajouter, dépose une archive ou un fichier <code>.ini</code> dans l'onglet
              Mods : il sera copié dans le dossier du jeu (system/cfg/ppfilters).
            </p>
            {!filters ? (
              <div className="skeleton" style={{ height: 110 }} />
            ) : filters.length === 0 ? (
              <div className="empty">Aucun filtre trouvé dans le dossier du jeu.</div>
            ) : (
              <div className="filter-grid">
                {filters.map((f, i) => (
                  <motion.button
                    key={f.id}
                    disabled={busy !== null}
                    className={`filter-card ${f.active ? "selected" : ""}`}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i, 12) * 0.03, duration: 0.35 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => chooseFilter(f.id)}
                  >
                    <span className="filter-name">{filterLabel(f.id)}</span>
                    <span className="row" style={{ gap: 6 }}>
                      {!f.builtin && <span className="tag accent">Ajouté</span>}
                      {f.active && (
                        <span className="filter-check">
                          <Check size={13} strokeWidth={3} />
                        </span>
                      )}
                    </span>
                  </motion.button>
                ))}
              </div>
            )}
          </section>
        </Item>

        {/* ------------------------------------------------------------------ Ciel et météo */}
        <Item>
          <section className="card stack">
            <CardTitle icon={<CloudSun size={16} />}>Ciel et météo</CardTitle>
            <div className="sky-steps">
              <div className="sky-step">
                <span className="num">1</span>
                <div className="grow">
                  <b>Trouve un mod de ciel</b>
                  <p className="muted small">Les plus connus s'appellent Sol et Pure : nuages, soleil, nuits étoilées et pluie bien plus réalistes.</p>
                </div>
                <Button size="sm" icon={<Store size={14} />} onClick={() => go("garage")}>
                  Ouvrir le Garage
                </Button>
              </div>
              <div className="sky-step">
                <span className="num">2</span>
                <div className="grow">
                  <b>Télécharge-le</b>
                  <p className="muted small">
                    Nexora-Corsa reconnaît l'archive dès la fin du téléchargement et propose de l'installer. Seuls les dossiers de météo sont copiés dans le jeu :
                    le reste de l'archive est ignoré.
                  </p>
                </div>
                <Button size="sm" variant="ghost" icon={<FolderPlus size={14} />} onClick={() => go("mods")}>
                  Installer un fichier
                </Button>
              </div>
              <div className="sky-step">
                <span className="num">3</span>
                <div className="grow">
                  <b>Choisis le style de ciel</b>
                  <p className="muted small">Une fois installé, il apparaît dans les listes ci-dessous. Le changement est pris en compte au prochain lancement.</p>
                </div>
              </div>
            </div>

            {weather && !weather.csp_installed && (
              <div className="notice warn" style={{ marginTop: 0 }}>
                <AlertTriangle size={16} />
                <span>
                  Le ciel dynamique demande Custom Shaders Patch.{" "}
                  <button className="link-btn" onClick={() => go("settings")}>
                    Voir dans les paramètres
                  </button>
                </span>
              </div>
            )}

            {weather && (
              <>
                <div className="fields two">
                  <Field label="Contrôleur (gère l'heure et les conditions)">
                    <select
                      className="select"
                      disabled={busy !== null || weather.controllers.length === 0}
                      value={weather.controller}
                      onChange={(e) => chooseWeather(e.target.value, weather.implementation)}
                    >
                      {!weather.controllers.includes(weather.controller) && (
                        <option value={weather.controller}>{weather.controller || "—"} (introuvable)</option>
                      )}
                      {weather.controllers.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Style de ciel (nuages, lumière)">
                    <select
                      className="select"
                      disabled={busy !== null || weather.implementations.length === 0}
                      value={weather.implementation}
                      onChange={(e) => chooseWeather(weather.controller, e.target.value)}
                    >
                      {!weather.implementations.includes(weather.implementation) && (
                        <option value={weather.implementation}>{weather.implementation || "—"} (introuvable)</option>
                      )}
                      {weather.implementations.map((i) => (
                        <option key={i}>{i}</option>
                      ))}
                    </select>
                  </Field>
                </div>
                {!weather.controllers.includes(weather.controller) && (
                  <div className="notice info" style={{ marginTop: -4 }}>
                    <AlertTriangle size={16} /> Le contrôleur « {weather.controller} » demandé par Custom Shaders Patch n'est pas installé. Choisis-en un dans la
                    liste, ou installe le mod de ciel correspondant.
                  </div>
                )}
                <div className="row wrap">
                  <span className="muted small">Réglages météo du jeu :</span>
                  <span className="tag">{weather.presets.filter((p) => p.builtin).length} d'origine</span>
                  {added > 0 && <span className="tag accent">{added} ajoutés</span>}
                  {weather.presets
                    .filter((p) => !p.builtin)
                    .slice(0, 8)
                    .map((p) => (
                      <span key={p.id} className="tag">
                        {p.id}
                      </span>
                    ))}
                </div>
              </>
            )}
          </section>
        </Item>
      </Stagger>
    </div>
  );
}
