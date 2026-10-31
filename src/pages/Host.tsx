import { listen } from "@tauri-apps/api/event";
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
import { Field, HourSlider, NumberInput, Toggle, WeatherSelect } from "../components/Fields";
import { CarPicker, TrackPicker } from "../components/Pickers";
import { useContent, usePersisted } from "../hooks";

interface Props {
  playerName: string;
  notify: (msg: string, kind?: "ok" | "error") => void;
}

const randomPassword = () => Math.random().toString(36).slice(2, 8);

const ASSIST_LABELS = ["Interdit", "D'origine", "Forcé"];

function InviteLine({
  label,
  ip,
  status,
  notify,
}: {
  label: string;
  ip: string;
  status: ServerStatus;
  notify: Props["notify"];
}) {
  const code = makeInvite(ip, status.tcp_port, status.http_port);
  const copy = () =>
    navigator.clipboard.writeText(code).then(
      () => notify("Code d'invitation copié."),
      () => notify("Copie impossible : sélectionne le code à la main.", "error"),
    );
  return (
    <p className="invite">
      <span className="muted small">{label} ({ip}) :</span> <code>{code}</code>{" "}
      <button className="btn small-btn" onClick={copy}>
        Copier
      </button>
    </p>
  );
}

export default function Host({ playerName, notify }: Props) {
  const { cars, tracks, weathers } = useContent();
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
  const [pick, setPick] = useState({ car: "", skin: "" });
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
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  const running = status?.running ?? false;
  const track = tracks.find((t) => t.id === s.track) ?? tracks.find((t) => t.id === "magione") ?? tracks[0];
  const pickCar = cars.find((c) => c.id === pick.car) ?? cars.find((c) => c.id === "bmw_m3_e30") ?? cars[0];
  if (!track || !pickCar) return null;
  const layout = track.layouts.some((l) => l.id === s.track_config) ? s.track_config : track.layouts[0].id;
  const pickSkin = pickCar.skins.includes(pick.skin) ? pick.skin : pickCar.skins[0];
  const weather = weathers.includes(s.weather) ? s.weather : (weathers.find((w) => w.includes("clear")) ?? weathers[0] ?? "");
  const set = (patch: Partial<ServerSettings>) => setS((p) => ({ ...p, ...patch }));
  const payload = (): ServerSettings => ({ ...s, track: track.id, track_config: layout, weather });

  const addCar = () => {
    if (s.cars.some((c) => c.model === pickCar.id)) {
      notify("Cette voiture est déjà dans la liste.", "error");
      return;
    }
    set({ cars: [...s.cars, { model: pickCar.id, skin: pickSkin, count: 1 }] });
  };
  const patchCar = (i: number, patch: Partial<ServerSettings["cars"][number]>) =>
    set({ cars: s.cars.map((c, j) => (j === i ? { ...c, ...patch } : c)) });

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
    const car = cars.find((c) => c.id === first?.model);
    if (!first || !car) return;
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
      {running && status && (
        <section className="card live">
          <div className="live-head">
            <div>
              <h2>🟢 {status.name}</h2>
              <p className="muted">
                Port <b>{status.tcp_port}</b>
                {status.has_password && " — mot de passe requis (à communiquer séparément)"}
              </p>
              {net?.public_ip && !net.cgnat && (
                <InviteLine label="Internet" ip={net.public_ip} status={status} notify={notify} />
              )}
              {net?.local_ip && <InviteLine label="Même réseau" ip={net.local_ip} status={status} notify={notify} />}
              {ports && ports.opened.length > 0 && (
                <p className="small ok-text">Ports ouverts sur la box : {ports.opened.join(", ")}</p>
              )}
              {ports && ports.failed.length > 0 && (
                <p className="small error">
                  Ports refusés par la box : {ports.failed.join(", ")} — ouvre-les à la main.
                </p>
              )}
              {net?.cgnat && (
                <p className="small error">
                  Ton fournisseur d'accès partage son adresse IP (CGNAT) : les amis hors de ton réseau ne pourront pas se
                  connecter sans VPN/tunnel, même avec les ports ouverts.
                </p>
              )}
              {net && !net.upnp && !ports && (
                <p className="muted small">
                  UPnP indisponible sur ta box : redirige les ports TCP/UDP {status.tcp_port} et TCP {status.http_port} vers ce PC.
                </p>
              )}
            </div>
            <div className="row">
              <button className="btn primary" onClick={joinMine}>
                Rejoindre mon serveur
              </button>
              <button className="btn danger" onClick={stop}>
                Arrêter
              </button>
            </div>
          </div>
        </section>
      )}

      <div className="columns">
        <section className="card">
          <h2>Circuit</h2>
          <TrackPicker track={track.id} layout={layout} onChange={(t, l) => set({ track: t, track_config: l })} />
        </section>

        <section className="card">
          <h2>Voitures autorisées</h2>
          <CarPicker car={pickCar.id} skin={pickSkin} onChange={(c, sk) => setPick({ car: c, skin: sk })} />
          <button className="btn" onClick={addCar}>
            + Ajouter à la liste
          </button>
          <div className="chosen">
            {s.cars.length === 0 && <p className="muted small">Ajoute au moins une voiture.</p>}
            {s.cars.map((c, i) => {
              const def = cars.find((x) => x.id === c.model);
              return (
                <div className="chosen-row" key={c.model}>
                  <span className="grow">{def?.name ?? c.model}</span>
                  <select className="input" value={c.skin} onChange={(e) => patchCar(i, { skin: e.target.value })}>
                    {(def?.skins ?? [c.skin]).map((sk) => (
                      <option key={sk}>{sk}</option>
                    ))}
                  </select>
                  <button className="icon-btn" title="Retirer" onClick={() => set({ cars: s.cars.filter((_, j) => j !== i) })}>
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        <section className="card options">
          <h2>Serveur</h2>
          <Field label="Nom">
            <input className="input" value={s.name} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <div className="row">
            <Field label="Places">
              <NumberInput value={s.max_clients} min={1} max={24} onChange={(v) => set({ max_clients: v })} />
            </Field>
            <Field label="Mot de passe">
              <input className="input" placeholder="(aucun)" value={s.password} onChange={(e) => set({ password: e.target.value })} />
            </Field>
          </div>
          <div className="row">
            <Field label="Essais (min)">
              <NumberInput value={s.practice_min} min={0} max={600} onChange={(v) => set({ practice_min: v })} />
            </Field>
            <Field label="Qualifs (min)">
              <NumberInput value={s.qualify_min} min={0} max={600} onChange={(v) => set({ qualify_min: v })} />
            </Field>
            <Field label="Course (tours)">
              <NumberInput value={s.race_laps} min={0} max={500} onChange={(v) => set({ race_laps: v })} />
            </Field>
          </div>
          <WeatherSelect value={weather} onChange={(v) => set({ weather: v })} />
          <HourSlider value={s.hour} onChange={(v) => set({ hour: v })} />
          <div className="row">
            <Field label="ABS">
              <select className="input" value={s.abs} onChange={(e) => set({ abs: Number(e.target.value) })}>
                {ASSIST_LABELS.map((l, i) => (
                  <option key={l} value={i}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Anti-patinage">
              <select className="input" value={s.tc} onChange={(e) => set({ tc: Number(e.target.value) })}>
                {ASSIST_LABELS.map((l, i) => (
                  <option key={l} value={i}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Toggle label="Contrôle de stabilité autorisé" checked={s.stability} onChange={(v) => set({ stability: v })} />
          <Toggle label="Embrayage automatique autorisé" checked={s.autoclutch} onChange={(v) => set({ autoclutch: v })} />
          <Toggle label="Rejoindre à tout moment (mode pickup)" checked={s.pickup_mode} onChange={(v) => set({ pickup_mode: v })} />
          <Toggle label="Visible dans la liste publique" checked={s.register_to_lobby} onChange={(v) => set({ register_to_lobby: v })} />
          <Toggle
            label="Ouvrir les ports automatiquement sur ma box (UPnP)"
            checked={prefs.auto_upnp}
            onChange={(v) => setPrefs({ auto_upnp: v })}
          />
          <details>
            <summary>Réglages avancés</summary>
            <div className="row">
              <Field label="Dégâts %">
                <NumberInput value={s.damage} min={0} max={100} onChange={(v) => set({ damage: v })} />
              </Field>
              <Field label="Carburant %">
                <NumberInput value={s.fuel} min={0} max={500} onChange={(v) => set({ fuel: v })} />
              </Field>
              <Field label="Usure pneus %">
                <NumberInput value={s.tyre_wear} min={0} max={500} onChange={(v) => set({ tyre_wear: v })} />
              </Field>
            </div>
            <div className="row">
              <Field label="Port TCP">
                <NumberInput value={s.tcp_port} min={1} max={65535} onChange={(v) => set({ tcp_port: v })} />
              </Field>
              <Field label="Port UDP">
                <NumberInput value={s.udp_port} min={1} max={65535} onChange={(v) => set({ udp_port: v })} />
              </Field>
              <Field label="Port HTTP">
                <NumberInput value={s.http_port} min={1} max={65535} onChange={(v) => set({ http_port: v })} />
              </Field>
            </div>
            <Field label="Mot de passe admin (commandes /admin en jeu)">
              <input className="input" value={s.admin_password} onChange={(e) => set({ admin_password: e.target.value })} />
            </Field>
          </details>
          <button className="btn primary big" disabled={busy || running || s.cars.length === 0} onClick={start}>
            {running ? "Serveur en cours…" : busy ? "Démarrage…" : "▶ Démarrer le serveur"}
          </button>
        </section>
      </div>

      {(running || log.length > 0) && (
        <section className="card">
          <h2>Console</h2>
          <pre className="console" ref={logRef}>
            {log.join("\n")}
          </pre>
        </section>
      )}
    </>
  );
}
