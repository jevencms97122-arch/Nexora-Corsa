import { motion } from "motion/react";
import { AlertTriangle, Check, Disc3, Gamepad2, Joystick, Keyboard, RotateCcw, Usb, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api, errorMessage, type ControlChange, type ControlDevice, type ControlsState, type InputMethod } from "../api";
import {
  deviceKind,
  formatKey,
  gamepadIds,
  keyFromEvent,
  keyName,
  methodFits,
  padButtonFromIndex,
  padName,
} from "../controls";
import type { Notify } from "../hooks";
import Button from "../ui/Button";
import { Field, Slider, Switch } from "../ui/Fields";
import Segmented from "../ui/Segmented";
import { CardTitle } from "../ui/PageHeader";

const METHODS: { id: InputMethod; title: string; text: string; icon: ReactNode }[] = [
  { id: "KEYBOARD", title: "Clavier & souris", text: "Flèches ou ZQSD, direction à la souris possible.", icon: <Keyboard size={26} /> },
  { id: "X360", title: "Manette Xbox", text: "Manette compatible XInput (Xbox 360, One, Series…).", icon: <Gamepad2 size={26} /> },
  { id: "JOYPAD", title: "Autre manette", text: "PlayStation, Stadia, Switch… (DirectInput).", icon: <Joystick size={26} /> },
  { id: "WHEEL", title: "Volant", text: "Volant et pédales : Logitech, Thrustmaster, Fanatec…", icon: <Disc3 size={26} /> },
];

type Mode = "key" | "pad" | "button";
interface Target {
  section: string;
  key: string;
  mode: Mode;
}

interface Action {
  section: string;
  label: string;
}
const GROUPS: { title: string; actions: Action[] }[] = [
  {
    title: "Conduite",
    actions: [
      { section: "GEARUP", label: "Rapport supérieur" },
      { section: "GEARDN", label: "Rapport inférieur" },
      { section: "HANDBRAKE", label: "Frein à main" },
      { section: "STARTER", label: "Démarreur" },
      { section: "DRS", label: "DRS" },
      { section: "KERS", label: "KERS" },
      { section: "BALANCEUP", label: "Répartition de freinage +" },
      { section: "BALANCEDN", label: "Répartition de freinage −" },
      { section: "TURBOUP", label: "Turbo +" },
      { section: "TURBODN", label: "Turbo −" },
      { section: "ENGINE_BRAKE_UP", label: "Frein moteur +" },
      { section: "ENGINE_BRAKE_DN", label: "Frein moteur −" },
    ],
  },
  {
    title: "Aides",
    actions: [
      { section: "ABS", label: "ABS" },
      { section: "ABSUP", label: "ABS +" },
      { section: "ABSDN", label: "ABS −" },
      { section: "TRACTION_CONTROL", label: "Anti-patinage" },
      { section: "TCUP", label: "Anti-patinage +" },
      { section: "TCDN", label: "Anti-patinage −" },
      { section: "AUTO_SHIFTER", label: "Boîte automatique" },
      { section: "IDEAL_LINE", label: "Ligne idéale" },
      { section: "ACTIVATE_AI", label: "Pilote automatique (IA)" },
    ],
  },
  {
    title: "Caméra et affichage",
    actions: [
      { section: "ACTION_CHANGE_CAMERA", label: "Changer de caméra" },
      { section: "GLANCELEFT", label: "Regarder à gauche" },
      { section: "GLANCERIGHT", label: "Regarder à droite" },
      { section: "GLANCEBACK", label: "Regarder derrière" },
      { section: "HIDE_APPS", label: "Masquer les applications" },
      { section: "DRIVER_NAMES", label: "Noms des pilotes" },
    ],
  },
  {
    title: "Divers",
    actions: [
      { section: "ACTION_HEADLIGHTS", label: "Phares" },
      { section: "ACTION_HEADLIGHTS_FLASH", label: "Appel de phares" },
      { section: "ACTION_HORN", label: "Klaxon" },
      { section: "ACTION_CELEBRATE", label: "Célébrer" },
      { section: "MOUSE_STEERING", label: "Direction à la souris" },
      { section: "RESET_RACE", label: "Recommencer la session" },
    ],
  },
];

const PEDALS = [
  { section: "STEER", label: "Volant" },
  { section: "THROTTLE", label: "Accélérateur" },
  { section: "BRAKES", label: "Frein" },
  { section: "CLUTCH", label: "Embrayage" },
];

/** Délai entre deux relevés des appareils branchés. */
const SYNC_MS = 5000;

const PERIPHERAL_LABEL: Record<string, string> = {
  Keyboard: "Clavier",
  Mouse: "Souris",
  HIDClass: "Périphérique de saisie",
  MEDIA: "Audio",
  AudioEndpoint: "Audio",
  Bluetooth: "Bluetooth",
  DiskDrive: "Stockage",
  SCSIAdapter: "Stockage",
  WPD: "Téléphone / appareil",
  Camera: "Caméra",
  Image: "Caméra",
  XnaComposite: "Manette",
};

const pct = (n: number) => `${Math.round(n * 100)} %`;

/** Page « Commandes » : méthode de conduite, appareils détectés, axes et touches de `controls.ini`. */
export default function ControlsPanel({ notify }: { notify: Notify }) {
  const [state, setState] = useState<ControlsState | null>(null);
  const [error, setError] = useState("");
  const [target, setTarget] = useState<Target | null>(null);
  const pending = useRef<ControlChange[]>([]);
  const timer = useRef<number | undefined>(undefined);
  const stateRef = useRef<ControlsState | null>(null);
  stateRef.current = state;

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .controlsState()
        .then((s) => alive && setState((old) => (old ? { ...old, devices: s.devices, peripherals: s.peripherals } : s)))
        .catch((e) => alive && setError(errorMessage(e)));
    load();
    // Les appareils branchés ou débranchés pendant que la page est ouverte apparaissent tout seuls.
    const poll = setInterval(load, SYNC_MS);
    return () => {
      alive = false;
      clearInterval(poll);
      window.clearTimeout(timer.current);
    };
  }, []);

  const get = (section: string, key: string, fallback = "") => state?.values[section]?.[key] ?? fallback;
  const num = (section: string, key: string, fallback: number) => {
    const n = Number.parseFloat(get(section, key));
    return Number.isFinite(n) ? n : fallback;
  };

  const flush = useCallback(() => {
    const batch = pending.current;
    pending.current = [];
    if (batch.length === 0) return;
    api
      .setControls(batch)
      .then((s) => {
        setState(s);
        setError("");
      })
      .catch((e) => {
        setError(errorMessage(e));
        api.controlsState().then(setState).catch(() => {});
      });
  }, []);

  /** Applique tout de suite à l'écran, écrit dans le fichier (après `delay` ms pour les curseurs). */
  const change = useCallback(
    (changes: ControlChange[], delay = 0) => {
      setState((s) => {
        if (!s) return s;
        const values = { ...s.values };
        for (const c of changes) {
          const section = c.section.toUpperCase();
          values[section] = { ...values[section], [c.key.toUpperCase()]: c.value.split(";")[0].trim() };
        }
        return { ...s, values };
      });
      for (const c of changes) {
        pending.current = pending.current.filter((p) => !(p.section === c.section && p.key === c.key));
        pending.current.push(c);
      }
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, delay);
    },
    [flush],
  );

  const method = (get("HEADER", "INPUT_METHOD", "KEYBOARD").toUpperCase() as InputMethod);
  const devices = state?.devices ?? [];
  const assigned = devices.filter((d) => d.index !== null);
  const unseen = devices.filter((d) => d.index === null);

  // Capture d'une touche ou d'un bouton : le prochain appui est enregistré.
  useEffect(() => {
    if (!target) return;
    let raf = 0;
    const done = () => setTarget(null);
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === "Escape") return done();
      if (target.mode !== "key") return;
      const k = keyFromEvent(e);
      if (!k) {
        notify("Cette touche n'est pas prise en charge.", "error");
        return;
      }
      change([{ section: target.section, key: target.key, value: formatKey(k.vk, k.label) }]);
      done();
    };
    window.addEventListener("keydown", onKey, true);

    if (target.mode !== "key") {
      const pressed = (p: Gamepad) => p.buttons.map((b) => b.pressed);
      const before = new Map<number, boolean[]>();
      for (const p of navigator.getGamepads()) if (p) before.set(p.index, pressed(p));
      const tick = () => {
        for (const p of navigator.getGamepads()) {
          if (!p) continue;
          const now = pressed(p);
          const was = before.get(p.index) ?? [];
          const hit = now.findIndex((down, i) => down && !was[i]);
          before.set(p.index, now);
          if (hit < 0) continue;
          if (target.mode === "pad") {
            const name = padButtonFromIndex(hit);
            if (!name) continue;
            change([{ section: target.section, key: "XBOXBUTTON", value: name }]);
          } else {
            const ids = gamepadIds(p.id);
            const known = ids && assigned.find((d) => d.vid === ids.vid && d.pid === ids.pid);
            const joy = known ? known.index : num("STEER", "JOY", -1) >= 0 ? num("STEER", "JOY", -1) : (assigned.find((d) => d.connected)?.index ?? 0);
            change([
              { section: target.section, key: "JOY", value: String(joy) },
              { section: target.section, key: "BUTTON", value: String(hit) },
            ]);
          }
          return done();
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }
    return () => {
      window.removeEventListener("keydown", onKey, true);
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  async function restore() {
    try {
      setState(await api.restoreControls());
      notify("Commandes d'origine restaurées.");
    } catch (e) {
      notify(errorMessage(e), "error");
    }
  }

  if (!state) {
    return error ? (
      <div className="notice danger">
        <AlertTriangle size={16} /> {error}
      </div>
    ) : (
      <div className="skeleton" style={{ height: 320, borderRadius: 16 }} />
    );
  }

  const deviceOptions = (current: number) => (
    <>
      <option value={-1}>Aucun</option>
      {assigned.map((d) => (
        <option key={d.index} value={d.index!}>
          {d.name}
          {d.connected ? "" : " (débranché)"}
        </option>
      ))}
      {current >= 0 && !assigned.some((d) => d.index === current) && <option value={current}>Appareil {current}</option>}
    </>
  );

  const slider = (label: string, section: string, key: string, min: number, max: number, step: number, fallback: number, show: (n: number) => string = (n) => String(n)) => {
    const value = num(section, key, fallback);
    return (
      <Field label={label} value={show(value)}>
        <Slider value={Math.min(max, Math.max(min, value))} min={min} max={max} step={step} onChange={(n) => change([{ section, key, value: String(Number(n.toFixed(3))) }], 350)} />
      </Field>
    );
  };

  const captureButton = (t: Target, display: string | null) => {
    const active = target?.section === t.section && target.key === t.key && target.mode === t.mode;
    return (
      <button className={`bind-btn ${active ? "listening" : ""} ${display ? "" : "empty"}`} onClick={() => setTarget(active ? null : t)}>
        {active ? (t.mode === "key" ? "Appuie sur une touche…" : "Appuie sur un bouton…") : (display ?? "Non assigné")}
      </button>
    );
  };

  const clearBtn = (changes: ControlChange[], shown: boolean) =>
    shown ? (
      <button className="icon-btn" title="Effacer" onClick={() => change(changes)}>
        <X size={15} />
      </button>
    ) : (
      <span style={{ width: 32 }} />
    );

  const buttonLabel = (section: string) => {
    const joy = get(section, "JOY", "-1");
    const button = get(section, "BUTTON", "-1");
    if (button === "-1" || joy === "-1") return null;
    const dev = devices.find((d) => String(d.index) === joy);
    return `${dev ? dev.name : `Appareil ${joy}`} · bouton ${button}`;
  };

  const missing =
    method === "KEYBOARD" ? null : !methodFits(method, devices) ? (
      method === "WHEEL" ? "Aucun volant branché pour l'instant." : method === "X360" ? "Aucune manette Xbox branchée pour l'instant." : "Aucune manette branchée pour l'instant."
    ) : null;
  const wheelLike = method === "WHEEL" || method === "JOYPAD";

  return (
    <div className="stack">
      <div className="notice info" style={{ marginTop: 0 }}>
        <AlertTriangle size={16} /> Ferme Assetto Corsa avant de modifier les commandes : le jeu réécrit son fichier en quittant.
      </div>
      {error && <div className="notice danger">{error}</div>}

      <section className="card stack">
        <CardTitle icon={<Gamepad2 size={16} />}>Comment conduis-tu ?</CardTitle>
        <div className="method-grid" role="radiogroup" aria-label="Méthode de conduite">
          {METHODS.map((m, i) => {
            const active = method === m.id;
            const detected = m.id !== "KEYBOARD" && methodFits(m.id, devices);
            return (
              <motion.button
                key={m.id}
                role="radio"
                aria-checked={active}
                className={`method-card ${active ? "selected" : ""}`}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05, duration: 0.35 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => !active && change([{ section: "HEADER", key: "INPUT_METHOD", value: m.id }])}
              >
                <span className="method-icon">{m.icon}</span>
                <span className="st-title" style={{ fontSize: 19 }}>{m.title}</span>
                <span className="st-text">{m.text}</span>
                <span className="method-tags">
                  {active && (
                    <span className="tag ok">
                      <Check size={12} /> Actif
                    </span>
                  )}
                  {detected && <span className="tag">Détecté</span>}
                </span>
              </motion.button>
            );
          })}
        </div>
        {missing && (
          <div className="notice warn" style={{ marginTop: 0 }}>
            <AlertTriangle size={16} /> {missing} Branche-le avant de lancer une partie, sinon le jeu ne pourra pas l'utiliser.
          </div>
        )}
        {method !== "KEYBOARD" && (
          <Switch
            label="Garder aussi le clavier actif"
            hint="Le clavier peut diriger en plus de la manette ou du volant."
            checked={get("ADVANCED", "COMBINE_WITH_KEYBOARD_CONTROL") === "1"}
            onChange={(on) => change([{ section: "ADVANCED", key: "COMBINE_WITH_KEYBOARD_CONTROL", value: on ? "1" : "0" }])}
          />
        )}
      </section>

      <section className="card stack">
        <CardTitle icon={<Joystick size={16} />} right={<span className="tag">{devices.filter((d) => d.connected).length} branché(s)</span>}>
          Appareils détectés
        </CardTitle>
        {devices.length === 0 ? (
          <div className="muted small">Aucun périphérique de jeu trouvé. Branche ton volant ou ta manette : la liste se met à jour toute seule.</div>
        ) : (
          <div className="list">
            {devices.map((d: ControlDevice) => (
              <div key={`${d.vid}-${d.pid}-${d.index}-${d.name}`} className="list-row">
                <span className={`dev-dot ${d.connected ? "on" : ""}`} title={d.connected ? "Branché" : "Débranché"} />
                <div className="grow">
                  <div className="title ellipsis">{d.name}</div>
                  <div className="sub">
                    {{ wheel: "Volant", xbox: "Manette Xbox", pad: "Manette" }[deviceKind(d.name)]} · {d.connected ? "branché" : "pas branché en ce moment"}
                  </div>
                </div>
                {d.index !== null && <span className="tag">JOY {d.index}</span>}
              </div>
            ))}
          </div>
        )}
        {unseen.length > 0 && (
          <div className="notice info" style={{ marginTop: 0 }}>
            <AlertTriangle size={16} /> {unseen.map((d) => d.name).join(", ")} : lance Assetto Corsa une fois pour qu'il enregistre ce périphérique, puis reviens ici.
          </div>
        )}
      </section>

      <section className="card stack">
        <CardTitle icon={<Usb size={16} />} right={<span className="sync-tag"><span className="dev-dot on pulse" /> Synchro toutes les 5 s</span>}>
          Autres appareils branchés
        </CardTitle>
        {state.peripherals.length === 0 ? (
          <div className="muted small">Aucun autre appareil USB ou Bluetooth détecté.</div>
        ) : (
          <div className="list">
            {state.peripherals.map((p) => (
              <div key={`${p.bus}-${p.name}`} className="list-row">
                <span className="dev-dot on" />
                <div className="grow">
                  <div className="title ellipsis">{p.name}</div>
                  <div className="sub">{PERIPHERAL_LABEL[p.class] ?? (p.class || "Appareil")}</div>
                </div>
                <span className="tag">{p.bus === "usb" ? "USB" : "Bluetooth"}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {method === "KEYBOARD" && (
        <section className="card stack">
          <CardTitle icon={<Keyboard size={16} />}>Clavier & souris</CardTitle>
          <div className="bind-list">
            {[
              ["GAS", "Accélérer"],
              ["BRAKE", "Freiner"],
              ["LEFT", "Tourner à gauche"],
              ["RIGHT", "Tourner à droite"],
            ].map(([key, label]) => (
              <div key={key} className="bind-row">
                <span className="grow">{label}</span>
                {captureButton({ section: "KEYBOARD", key, mode: "key" }, keyName(get("KEYBOARD", key)))}
              </div>
            ))}
          </div>
          <div className="two-col">
            {slider("Vitesse de braquage", "KEYBOARD", "STEERING_SPEED", 0.5, 5, 0.05, 1.75, (n) => n.toFixed(2))}
            {slider("Retour au centre", "KEYBOARD", "STEER_RESET_SPEED", 0.5, 5, 0.05, 1.8, (n) => n.toFixed(2))}
          </div>
          <Switch
            label="Diriger à la souris"
            hint="Le mouvement horizontal de la souris braque les roues."
            checked={get("KEYBOARD", "MOUSE_STEER") === "1"}
            onChange={(on) => change([{ section: "KEYBOARD", key: "MOUSE_STEER", value: on ? "1" : "0" }])}
          />
          <Switch
            label="Accélérer et freiner à la souris"
            checked={get("KEYBOARD", "MOUSE_ACCELERATOR_BRAKE") === "1"}
            onChange={(on) => change([{ section: "KEYBOARD", key: "MOUSE_ACCELERATOR_BRAKE", value: on ? "1" : "0" }])}
          />
          {get("KEYBOARD", "MOUSE_STEER") === "1" && slider("Sensibilité de la souris", "KEYBOARD", "MOUSE_SPEED", 0.01, 1, 0.01, 0.1, (n) => n.toFixed(2))}
        </section>
      )}

      {method === "X360" && (
        <section className="card stack">
          <CardTitle icon={<Gamepad2 size={16} />}>Manette Xbox</CardTitle>
          <Field label="Manette utilisée">
            <select className="select" value={num("X360", "JOYPAD_INDEX", 0)} onChange={(e) => change([{ section: "X360", key: "JOYPAD_INDEX", value: e.target.value }])}>
              {assigned.map((d) => (
                <option key={d.index} value={d.index!}>
                  {d.name}
                  {d.connected ? "" : " (débranché)"}
                </option>
              ))}
              {!assigned.some((d) => d.index === num("X360", "JOYPAD_INDEX", 0)) && <option value={num("X360", "JOYPAD_INDEX", 0)}>Manette {num("X360", "JOYPAD_INDEX", 0)}</option>}
            </select>
          </Field>
          <Field label="Direction au stick">
            <Segmented
              value={(get("X360", "STEER_THUMB", "LEFT").toUpperCase() === "RIGHT" ? "RIGHT" : "LEFT") as "LEFT" | "RIGHT"}
              options={[
                { value: "LEFT", label: "Stick gauche" },
                { value: "RIGHT", label: "Stick droit" },
              ]}
              onChange={(v) => change([{ section: "X360", key: "STEER_THUMB", value: v }])}
            />
          </Field>
          <div className="two-col">
            {slider("Zone morte", "X360", "STEER_DEADZONE", 0, 0.5, 0.01, 0.05, pct)}
            {slider("Courbe de direction", "X360", "STEER_GAMMA", 1, 5, 0.05, 3, (n) => n.toFixed(2))}
            {slider("Lissage", "X360", "STEER_FILTER", 0, 1, 0.01, 0.6, pct)}
            {slider("Vitesse de braquage", "X360", "STEER_SPEED", 0, 1, 0.01, 0.2, pct)}
            {slider("Adaptation à la vitesse", "X360", "SPEED_SENSITIVITY", 0, 1, 0.01, 0.5, pct)}
            {slider("Vibrations", "X360", "RUMBLE_INTENSITY", 0, 2, 0.05, 1, pct)}
          </div>
        </section>
      )}

      {wheelLike && (
        <section className="card stack">
          <CardTitle icon={wheelLike && method === "WHEEL" ? <Disc3 size={16} /> : <Joystick size={16} />}>{method === "WHEEL" ? "Volant et pédales" : "Axes de la manette"}</CardTitle>
          <p className="muted small" style={{ margin: "-6px 0 0" }}>
            Choisis l'appareil et l'axe de chaque commande (axes numérotés de 0 à 7 comme dans le jeu). Pour trouver le bon axe, bouge la pédale ou le volant dans Options → Commandes du jeu.
          </p>
          <div className="axis-table">
            {PEDALS.map((p) => {
              if (method === "JOYPAD" && p.section !== "STEER" && p.section !== "THROTTLE" && p.section !== "BRAKES") return null;
              const joy = num(p.section, "JOY", -1);
              const inverted = p.section !== "STEER" && num(p.section, "MIN", -1) > num(p.section, "MAX", 1);
              return (
                <div key={p.section} className="axis-row">
                  <b>{p.label}</b>
                  <select
                    className="select"
                    aria-label={`Appareil : ${p.label}`}
                    value={joy}
                    onChange={(e) => {
                      const v = e.target.value;
                      const changes = [{ section: p.section, key: "JOY", value: v }];
                      // Le volant et les pédales sont le plus souvent sur le même appareil : on aligne celles qui n'en ont pas.
                      if (p.section === "STEER" && Number(v) >= 0) {
                        for (const q of PEDALS.slice(1)) if (num(q.section, "JOY", -1) < 0) changes.push({ section: q.section, key: "JOY", value: v });
                      }
                      change(changes);
                    }}
                  >
                    {deviceOptions(joy)}
                  </select>
                  <select className="select" aria-label={`Axe : ${p.label}`} value={num(p.section, "AXLE", -1)} onChange={(e) => change([{ section: p.section, key: "AXLE", value: e.target.value }])}>
                    <option value={-1}>Aucun axe</option>
                    {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => (
                      <option key={n} value={n}>
                        Axe {n}
                      </option>
                    ))}
                  </select>
                  {p.section !== "STEER" ? (
                    <label className="mini-switch" title="Inverse l'axe si la pédale agit à l'envers">
                      <input
                        type="checkbox"
                        checked={inverted}
                        onChange={(e) => {
                          const lo = Math.min(num(p.section, "MIN", -1), num(p.section, "MAX", 1));
                          const hi = Math.max(num(p.section, "MIN", -1), num(p.section, "MAX", 1));
                          change([
                            { section: p.section, key: "MIN", value: String(e.target.checked ? hi : lo) },
                            { section: p.section, key: "MAX", value: String(e.target.checked ? lo : hi) },
                          ]);
                        }}
                      />
                      Inversé
                    </label>
                  ) : (
                    <span />
                  )}
                </div>
              );
            })}
          </div>
          {method === "WHEEL" && (
            <div className="two-col">
              {slider("Angle de rotation du volant", "STEER", "LOCK", 90, 1080, 10, 900, (n) => `${n}°`)}
              {slider("Force du retour de force", "STEER", "FF_GAIN", 0, 2, 0.05, 1, pct)}
              {slider("Filtre du retour de force", "STEER", "FILTER_FF", 0, 1, 0.01, 0, pct)}
              {slider("Courbe de direction", "STEER", "STEER_GAMMA", 0.5, 3, 0.05, 1, (n) => n.toFixed(2))}
            </div>
          )}
        </section>
      )}

      <section className="card stack">
        <CardTitle icon={<Keyboard size={16} />}>Touches et boutons</CardTitle>
        <p className="muted small" style={{ margin: "-6px 0 0" }}>
          Clique sur une case puis appuie sur la touche{method === "X360" ? " ou le bouton de la manette" : wheelLike ? " ou le bouton du volant" : ""} à utiliser. Échap annule.
        </p>
        {GROUPS.map((g) => {
          const rows = g.actions.filter((a) => state.values[a.section]);
          if (rows.length === 0) return null;
          return (
            <div key={g.title} className="bind-group">
              <div className="bind-title">
                <span>{g.title}</span>
                <span>Clavier</span>
                {method === "X360" && <span>Manette</span>}
                {wheelLike && <span>Bouton</span>}
                <span style={{ width: 32 }} />
              </div>
              {rows.map((a) => {
                const hasPad = "XBOXBUTTON" in (state.values[a.section] ?? {});
                const keyShown = keyName(get(a.section, "KEY"));
                return (
                  <div key={a.section} className="bind-row">
                    <span className="grow">{a.label}</span>
                    {captureButton({ section: a.section, key: "KEY", mode: "key" }, keyShown)}
                    {method === "X360" &&
                      (hasPad ? (
                        captureButton({ section: a.section, key: "XBOXBUTTON", mode: "pad" }, padName(get(a.section, "XBOXBUTTON")))
                      ) : (
                        <span className="bind-btn empty disabled">—</span>
                      ))}
                    {wheelLike && captureButton({ section: a.section, key: "BUTTON", mode: "button" }, buttonLabel(a.section))}
                    {clearBtn(
                      [
                        { section: a.section, key: "KEY", value: "-1" },
                        ...(method === "X360" && hasPad ? [{ section: a.section, key: "XBOXBUTTON", value: "-1" }] : []),
                        ...(wheelLike ? [{ section: a.section, key: "JOY", value: "-1" }, { section: a.section, key: "BUTTON", value: "-1" }] : []),
                      ],
                      !!keyShown || (method === "X360" && padName(get(a.section, "XBOXBUTTON")) !== null) || (wheelLike && buttonLabel(a.section) !== null),
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </section>

      <section className="card">
        <div className="row">
          <div className="grow">
            <div style={{ fontWeight: 600 }}>Restaurer les commandes d'origine</div>
            <div className="muted small">
              {state.has_backup ? "Remet le fichier tel qu'il était avant ta première modification ici." : "Disponible dès que tu as modifié quelque chose."}
            </div>
          </div>
          <Button icon={<RotateCcw size={15} />} disabled={!state.has_backup} onClick={restore}>
            Restaurer
          </Button>
        </div>
      </section>
    </div>
  );
}
