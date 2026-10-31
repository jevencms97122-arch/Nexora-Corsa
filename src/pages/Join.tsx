import { AnimatePresence, motion } from "motion/react";
import { CheckCircle2, ClipboardPaste, LogIn, Settings2, Ticket, XCircle } from "lucide-react";
import { useState } from "react";
import { api, errorMessage, parseInvite } from "../api";
import { CarGrid, SkinStrip } from "../components/Pickers";
import { HeroPreview, Specs } from "../components/Summary";
import { useContent, usePersisted, type Notify } from "../hooks";
import Button from "../ui/Button";
import { Field, Stepper } from "../ui/Fields";
import { CardTitle } from "../ui/PageHeader";

interface Props {
  playerName: string;
  notify: Notify;
}

export default function Join({ playerName, notify }: Props) {
  const { cars } = useContent();
  const [s, setS] = usePersisted("nexora.join", {
    ip: "",
    tcp_port: 9600,
    http_port: 8081,
    password: "",
    car: "",
    skin: "",
  });
  const [code, setCode] = useState("");
  const [manual, setManual] = useState(false);
  const [busy, setBusy] = useState(false);
  const car = cars.find((c) => c.id === s.car) ?? cars.find((c) => c.id === "bmw_m3_e30") ?? cars[0];
  if (!car) return null;
  const skin = car.skins.includes(s.skin) ? s.skin : car.skins[0];
  const parsed = code.trim() ? parseInvite(code) : null;

  function applyCode(value: string) {
    setCode(value);
    const p = parseInvite(value);
    if (p) setS({ ...s, ...p });
  }

  async function paste() {
    try {
      applyCode(await navigator.clipboard.readText());
    } catch {
      notify("Impossible de lire le presse-papiers : colle le code à la main.", "error");
    }
  }

  async function join() {
    if (!s.ip.trim()) {
      notify("Colle un code d'invitation ou entre l'adresse IP du serveur.", "error");
      return;
    }
    setBusy(true);
    try {
      await api.joinServer({ ...s, ip: s.ip.trim(), car: car.id, skin, player_name: playerName });
      notify("Connexion au serveur… Assetto Corsa démarre.");
    } catch (e) {
      notify(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="config-layout">
      <section className="card">
        <CardTitle>Ta voiture</CardTitle>
        <CarGrid compact selected={[car.id]} skinOf={() => skin} onPick={(c) => setS({ ...s, car: c.id, skin: c.skins[0] })} />
      </section>

      <aside className="summary">
        <HeroPreview car={car} skin={skin} title={car.name} subtitle={car.brand} />
        <section className="card stack">
          <SkinStrip car={car} skin={skin} onChange={(v) => setS({ ...s, skin: v })} />
          <Specs car={car} />
          <div className="divider" />
          <Field label="Code d'invitation">
            <div className="row">
              <div className="code-input grow input-icon">
                <Ticket size={17} />
                <input className="input" placeholder="NXC-…" value={code} onChange={(e) => applyCode(e.target.value)} />
                <AnimatePresence>
                  {code.trim() && (
                    <motion.span className="status" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>
                      {parsed ? <CheckCircle2 size={18} color="var(--ok)" /> : <XCircle size={18} color="var(--danger)" />}
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>
              <Button icon={<ClipboardPaste size={16} />} onClick={paste} title="Coller">
                Coller
              </Button>
            </div>
          </Field>
          <AnimatePresence>
            {parsed && (
              <motion.div className="notice ok" style={{ marginTop: 0 }} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                <CheckCircle2 size={16} /> Serveur {parsed.ip}:{parsed.tcp_port}
              </motion.div>
            )}
          </AnimatePresence>
          <button className="btn ghost sm" style={{ alignSelf: "flex-start" }} onClick={() => setManual((m) => !m)}>
            <Settings2 size={14} /> {manual ? "Masquer" : "Saisir l'adresse à la main"}
          </button>
          <AnimatePresence initial={false}>
            {manual && (
              <motion.div className="stack" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} style={{ overflow: "hidden" }}>
                <Field label="Adresse IP">
                  <input className="input" placeholder="ex. 192.168.1.20" value={s.ip} onChange={(e) => setS({ ...s, ip: e.target.value })} />
                </Field>
                <div className="fields two">
                  <Field label="Port TCP/UDP">
                    <Stepper value={s.tcp_port} min={1} max={65535} onChange={(v) => setS({ ...s, tcp_port: v })} />
                  </Field>
                  <Field label="Port HTTP">
                    <Stepper value={s.http_port} min={1} max={65535} onChange={(v) => setS({ ...s, http_port: v })} />
                  </Field>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <Field label="Mot de passe (si le serveur en a un)">
            <input className="input" value={s.password} onChange={(e) => setS({ ...s, password: e.target.value })} />
          </Field>
          <Button variant="primary" size="lg" block shine loading={busy} icon={<LogIn size={18} />} onClick={join}>
            Rejoindre la partie
          </Button>
          <span className="muted tiny">Ta voiture doit faire partie de celles autorisées par le serveur.</span>
        </section>
      </aside>
    </div>
  );
}
