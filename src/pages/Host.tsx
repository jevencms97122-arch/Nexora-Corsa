import { listen } from "@tauri-apps/api/event";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  Flag,
  Globe,
  House,
  KeyRound,
  LogIn,
  Map,
  Power,
  Rocket,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Users,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  api,
  errorMessage,
  makeInvite,
  type NetworkInfo,
  type PortsResult,
  type ServerSettings,
  type ServerStatus,
} from "../api";
import { carPreview } from "../assets";
import { CarGrid, TrackGrid } from "../components/Pickers";
import { HeroPreview, RecapLine, StepPanel } from "../components/Summary";
import { useContent, usePersisted, type Notify } from "../hooks";
import Button from "../ui/Button";
import { Field, HourSlider, Stepper, Switch, WeatherSelect } from "../ui/Fields";
import Img from "../ui/Img";
import { CardTitle } from "../ui/PageHeader";
import Segmented from "../ui/Segmented";

interface Props {
  playerName: string;
  notify: Notify;
}

type Step = "track" | "cars" | "rules";
const STEPS: Step[] = ["track", "cars", "rules"];
const ASSIST_LABELS = ["Interdit", "D'origine", "Forcé"];
const randomPassword = () => Math.random().toString(36).slice(2, 8);

function InviteLine({ icon, label, ip, status }: { icon: React.ReactNode; label: string; ip: string; status: ServerStatus }) {
  const code = makeInvite(ip, status.tcp_port, status.http_port);
  const [copied, setCopied] = useState(false);
  const copy = () =>
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  return (
    <div className="invite">
      <span className="kind-dot join">{icon}</span>
      <div className="grow stack tight">
        <span className="small text-2">
          {label} · <span className="muted">{ip}</span>
        </span>
        <code>{code}</code>
      </div>
      <Button size="sm" onClick={copy} icon={copied ? <Check size={14} /> : <Copy size={14} />}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span key={String(copied)} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}>
            {copied ? "Copié" : "Copier"}
          </motion.span>
        </AnimatePresence>
      </Button>
    </div>
  );
}

function logClass(line: string) {
  const l = line.toLowerCase();
  if (l.includes("error") || l.includes("erreur") || l.includes("fail")) return "ln err";
  if (l.includes("warning")) return "ln warn";
  return "ln";
}

export default function Host({ playerName, notify }: Props) {
  const { acPath, cars, tracks, weathers } = useContent();
  const [s, setS] = usePersisted<ServerSettings>("nexora.host", {
    name: "Serveur Nexora-Corsa",
    password: "",
    admin_password: randomPassword(),
    track: "",
    track_config: "",
    cars: [],
    max_clients: 10,
    udp_port: 9600,
    tcp_port: 9600,
    http_port: 8081,
    register_to_lobby: false,
    pickup_mode: true,
    practice_min: 10,
    qualify_min: 0,
    race_laps: 5,
    race_wait_secs: 60,
    weather: "",
    hour: 14,
    ambient_temp: 22,
    abs: 1,
    tc: 1,
    stability: false,
    autoclutch: false,
    damage: 100,
    fuel: 100,
    tyre_wear: 100,
  });
  const [step, setStep] = useState<Step>("track");
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [net, setNet] = useState<NetworkInfo | null>(null);
  const [ports, setPorts] = useState<PortsResult | null>(null);
  const [prefs, setPrefs] = usePersisted("nexora.net", { auto_upnp: true });
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    api.serverStatus().then(setStatus).catch(() => {});
    api.serverLog().then(setLog).catch(() => {});
    api.networkInfo().then(setNet).catch(() => {});
    const unlisten = Promise.all([
      listen<string>("server-log", (e) => setLog((l) => [...l.slice(-499), e.payload])),
      listen("server-stopped", () => {
        setStatus((st) => (st ? { ...st, running: false } : st));
        setPorts(null);
        api.closePorts().catch(() => {});
      }),
    ]);
    return () => {
      unlisten.then((fns) => fns.forEach((f) => f()));
    };
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [log]);

  const running = status?.running ?? false;
  const track = tracks.find((t) => t.id === s.track) ?? tracks.find((t) => t.id === "magione") ?? tracks[0];
  if (!track) return null;
  const layout = track.layouts.find((l) => l.id === s.track_config) ?? track.layouts[0];
  const weather = weathers.includes(s.weather) ? s.weather : (weathers.find((w) => w.includes("clear")) ?? weathers[0] ?? "");
  const set = (patch: Partial<ServerSettings>) => setS((p) => ({ ...p, ...patch }));
  const payload = (): ServerSettings => ({ ...s, track: track.id, track_config: layout.id, weather });
  const index = STEPS.indexOf(step);
  const firstCar = cars.find((c) => c.id === s.cars[0]?.model);

  const toggleCar = (id: string, firstSkin: string) =>
    set({
      cars: s.cars.some((c) => c.model === id)
        ? s.cars.filter((c) => c.model !== id)
        : [...s.cars, { model: id, skin: firstSkin, count: 1 }],
    });
  const patchCar = (model: string, skin: string) => set({ cars: s.cars.map((c) => (c.model === model ? { ...c, skin } : c)) });

  async function start() {
    setBusy(true);
    try {
      setLog([]);
      const st = await api.startServer(payload());
      setStatus(st);
      notify("Serveur démarré.");
      if (prefs.auto_upnp) {
        setPorts(null);
        const res = await api.openPorts(st.tcp_port, st.udp_port, st.http_port).catch((e) => {
          notify(errorMessage(e), "error");
          return null;
        });
        setPorts(res);
      }
      api.networkInfo().then(setNet).catch(() => {});
    } catch (e) {
      notify(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    await api.stopServer();
    setStatus((st) => (st ? { ...st, running: false } : st));
    setPorts(null);
    api.closePorts().catch(() => {});
  }

  async function joinMine() {
    const first = s.cars[0];
    if (!first) return;
    try {
      await api.joinServer({
        ip: "127.0.0.1",
        tcp_port: s.tcp_port,
        http_port: s.http_port,
        password: s.password,
        car: first.model,
        skin: first.skin,
        player_name: playerName,
      });
      notify("Connexion à ton serveur… Assetto Corsa démarre.");
    } catch (e) {
      notify(errorMessage(e), "error");
    }
  }

  return (
    <>
      <AnimatePresence>
        {running && status && (
          <motion.section
            className="live"
            initial={{ opacity: 0, y: -12, height: 0, marginBottom: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto", marginBottom: 20 }}
            exit={{ opacity: 0, y: -12, height: 0, marginBottom: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="live-head">
              <div className="live-title">
                <span className="live-dot" />
                <div>
                  <h2>{status.name}</h2>
                  <div className="row small muted" style={{ marginTop: 4 }}>
                    <span className="tag ok">En ligne</span>
                    <span>Port {status.tcp_port}</span>
                    {status.has_password && (
                      <span className="tag">
                        <KeyRound size={12} /> Mot de passe
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="row">
                <Button variant="primary" icon={<LogIn size={16} />} onClick={joinMine}>
                  Rejoindre mon serveur
                </Button>
                <Button variant="danger" icon={<Power size={16} />} onClick={stop}>
                  Arrêter
                </Button>
              </div>
            </div>
            <div className="invites">
              {net?.public_ip && !net.cgnat && <InviteLine icon={<Globe size={16} />} label="Internet" ip={net.public_ip} status={status} />}
              {net?.local_ip && <InviteLine icon={<House size={16} />} label="Même réseau" ip={net.local_ip} status={status} />}
            </div>
            {ports && ports.opened.length > 0 && (
              <div className="notice ok">
                <ShieldCheck size={16} /> Ports ouverts automatiquement sur ta box : {ports.opened.join(", ")}
              </div>
            )}
            {ports && ports.failed.length > 0 && (
              <div className="notice danger">
                <ShieldAlert size={16} /> Ports refusés par la box : {ports.failed.join(", ")}. Ouvre-les à la main.
              </div>
            )}
            {net?.cgnat && (
              <div className="notice warn">
                <ShieldAlert size={16} /> Ton fournisseur d'accès partage ton adresse IP (CGNAT) : les amis hors de ton réseau ne pourront
                pas se connecter sans VPN ou tunnel.
              </div>
            )}
            {net && !net.upnp && !ports && (
              <div className="notice info">
                <ShieldAlert size={16} /> UPnP indisponible : redirige les ports TCP/UDP {status.tcp_port} et TCP {status.http_port} vers ce PC.
              </div>
            )}
          </motion.section>
        )}
      </AnimatePresence>

      <div className="config-layout">
        <section className="card">
          <Segmented
            block
            hot
            value={step}
            onChange={setStep}
            options={[
              { value: "track", label: "Circuit", num: 1, done: index > 0 },
              { value: "cars", label: `Voitures${s.cars.length ? ` (${s.cars.length})` : ""}`, num: 2, done: s.cars.length > 0 && index > 1 },
              { value: "rules", label: "Règles", num: 3 },
            ]}
          />
          <div style={{ marginTop: 20 }}>
            <StepPanel step={step}>
              {step === "track" && (
                <TrackGrid selected={track.id} layout={layout.id} onPick={(t, l) => set({ track: t.id, track_config: l.id })} />
              )}
              {step === "cars" && (
                <div className="stack">
                  <div className="notice info" style={{ marginTop: 0 }}>
                    <Users size={16} /> Clique sur les voitures pour les autoriser sur le serveur (plusieurs possibles).
                  </div>
                  <CarGrid
                    compact
                    selected={s.cars.map((c) => c.model)}
                    skinOf={(id) => s.cars.find((c) => c.model === id)?.skin}
                    onPick={(c) => toggleCar(c.id, c.skins[0])}
                  />
                </div>
              )}
              {step === "rules" && (
                <div className="stack" style={{ gap: 20 }}>
                  <div className="fields three">
                    <Field label="Essais (min)">
                      <Stepper value={s.practice_min} min={0} max={600} step={5} onChange={(v) => set({ practice_min: v })} />
                    </Field>
                    <Field label="Qualifs (min)">
                      <Stepper value={s.qualify_min} min={0} max={600} step={5} onChange={(v) => set({ qualify_min: v })} />
                    </Field>
                    <Field label="Course (tours)">
                      <Stepper value={s.race_laps} min={0} max={500} onChange={(v) => set({ race_laps: v })} />
                    </Field>
                  </div>
                  <div className="fields two">
                    <WeatherSelect value={weather} onChange={(v) => set({ weather: v })} />
                    <HourSlider value={s.hour} onChange={(v) => set({ hour: v })} />
                  </div>
                  <div className="fields two">
                    <Field label="ABS">
                      <Segmented block value={String(s.abs)} onChange={(v) => set({ abs: Number(v) })} options={ASSIST_LABELS.map((l, i) => ({ value: String(i), label: l }))} />
                    </Field>
                    <Field label="Anti-patinage">
                      <Segmented block value={String(s.tc)} onChange={(v) => set({ tc: Number(v) })} options={ASSIST_LABELS.map((l, i) => ({ value: String(i), label: l }))} />
                    </Field>
                  </div>
                  <div className="fields two">
                    <Switch label="Contrôle de stabilité" hint="Autorisé pour les joueurs" checked={s.stability} onChange={(v) => set({ stability: v })} />
                    <Switch label="Embrayage automatique" hint="Autorisé pour les joueurs" checked={s.autoclutch} onChange={(v) => set({ autoclutch: v })} />
                    <Switch label="Rejoindre à tout moment" hint="Mode pickup" checked={s.pickup_mode} onChange={(v) => set({ pickup_mode: v })} />
                    <Switch label="Visible publiquement" hint="Dans la liste des serveurs du jeu" checked={s.register_to_lobby} onChange={(v) => set({ register_to_lobby: v })} />
                    <Switch label="Ouvrir les ports automatiquement" hint="UPnP sur ta box" checked={prefs.auto_upnp} onChange={(v) => setPrefs({ auto_upnp: v })} />
                  </div>
                  <details>
                    <summary className="muted small" style={{ cursor: "pointer" }}>Réglages avancés</summary>
                    <div className="stack" style={{ marginTop: 14 }}>
                      <div className="fields three">
                        <Field label="Dégâts %">
                          <Stepper value={s.damage} min={0} max={100} step={10} onChange={(v) => set({ damage: v })} />
                        </Field>
                        <Field label="Carburant %">
                          <Stepper value={s.fuel} min={0} max={500} step={10} onChange={(v) => set({ fuel: v })} />
                        </Field>
                        <Field label="Usure pneus %">
                          <Stepper value={s.tyre_wear} min={0} max={500} step={10} onChange={(v) => set({ tyre_wear: v })} />
                        </Field>
                      </div>
                      <div className="fields three">
                        <Field label="Port TCP">
                          <Stepper value={s.tcp_port} min={1} max={65535} onChange={(v) => set({ tcp_port: v })} />
                        </Field>
                        <Field label="Port UDP">
                          <Stepper value={s.udp_port} min={1} max={65535} onChange={(v) => set({ udp_port: v })} />
                        </Field>
                        <Field label="Port HTTP">
                          <Stepper value={s.http_port} min={1} max={65535} onChange={(v) => set({ http_port: v })} />
                        </Field>
                      </div>
                      <Field label="Mot de passe admin (commandes /admin en jeu)">
                        <input className="input" value={s.admin_password} onChange={(e) => set({ admin_password: e.target.value })} />
                      </Field>
                    </div>
                  </details>
                </div>
              )}
            </StepPanel>
          </div>
          <div className="step-nav">
            <Button variant="ghost" icon={<ArrowLeft size={16} />} disabled={index === 0} onClick={() => setStep(STEPS[index - 1])}>
              Précédent
            </Button>
            {index < STEPS.length - 1 && (
              <Button onClick={() => setStep(STEPS[index + 1])}>
                Suivant <ArrowRight size={16} />
              </Button>
            )}
          </div>
        </section>

        <aside className="summary">
          <HeroPreview
            car={firstCar}
            skin={s.cars[0]?.skin}
            track={track}
            layout={layout.id}
            title={s.name || "Mon serveur"}
            subtitle={layout.name}
          />
          <section className="card stack">
            <Field label="Nom du serveur">
              <input className="input" value={s.name} onChange={(e) => set({ name: e.target.value })} />
            </Field>
            <div className="fields two">
              <Field label="Places">
                <Stepper value={s.max_clients} min={1} max={24} onChange={(v) => set({ max_clients: v })} />
              </Field>
              <Field label="Mot de passe">
                <input className="input" placeholder="Aucun" value={s.password} onChange={(e) => set({ password: e.target.value })} />
              </Field>
            </div>
            <div className="field-label" style={{ marginTop: 4 }}>
              <span>Voitures autorisées</span>
              <span className="tag">{s.cars.length}</span>
            </div>
            <div className="chosen-cars">
              <AnimatePresence initial={false}>
                {s.cars.length === 0 && (
                  <motion.div key="none" className="muted small" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                    Aucune voiture : choisis-les à l'étape 2.
                  </motion.div>
                )}
                {s.cars.map((c) => {
                  const def = cars.find((x) => x.id === c.model);
                  return (
                    <motion.div
                      key={c.model}
                      className="chosen-car"
                      layout
                      initial={{ opacity: 0, x: 16 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -16, height: 0, padding: 0, marginTop: -8 }}
                      transition={{ duration: 0.25 }}
                    >
                      <div className="thumb">
                        <Img srcs={carPreview(acPath, c.model, c.skin)} />
                      </div>
                      <div className="grow stack tight">
                        <span className="small ellipsis" style={{ fontWeight: 600 }}>{def?.name ?? c.model}</span>
                        <select className="select" value={c.skin} onChange={(e) => patchCar(c.model, e.target.value)} title="Livrée">
                          {(def?.skins ?? [c.skin]).map((sk) => (
                            <option key={sk}>{sk}</option>
                          ))}
                        </select>
                      </div>
                      <button className="icon-btn danger" title="Retirer" onClick={() => toggleCar(c.model, c.skin)}>
                        <X size={15} />
                      </button>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
            <div className="recap">
              <RecapLine icon={<Map size={15} />} k="Circuit" v={layout.name} />
              <RecapLine
                icon={<Flag size={15} />}
                k="Sessions"
                v={[s.practice_min && `Essais ${s.practice_min}′`, s.qualify_min && `Qualifs ${s.qualify_min}′`, s.race_laps && `Course ${s.race_laps} t.`]
                  .filter(Boolean)
                  .join(" · ") || "Aucune"}
              />
            </div>
            <Button
              variant="primary"
              size="lg"
              block
              shine={!running}
              loading={busy}
              disabled={running || s.cars.length === 0}
              icon={<Rocket size={18} />}
              onClick={start}
            >
              {running ? "Serveur en cours" : "Démarrer le serveur"}
            </Button>
          </section>
        </aside>
      </div>

      <AnimatePresence>
        {(running || log.length > 0) && (
          <motion.section className="card" style={{ marginTop: 22 }} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <CardTitle icon={<Terminal size={16} />} right={<span className="muted small">{log.length} lignes</span>}>
              Console du serveur
            </CardTitle>
            <pre className="console" ref={logRef}>
              {log.map((line, i) => (
                <span key={i} className={logClass(line)}>
                  {line}
                  {"\n"}
                </span>
              ))}
            </pre>
          </motion.section>
        )}
      </AnimatePresence>
    </>
  );
}
