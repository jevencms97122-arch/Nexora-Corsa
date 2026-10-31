import { useState } from "react";
import { api, errorMessage, parseInvite } from "../api";
import { Field, NumberInput } from "../components/Fields";
import { CarPicker } from "../components/Pickers";
import { useContent, usePersisted } from "../hooks";

interface Props {
  playerName: string;
  notify: (msg: string, kind?: "ok" | "error") => void;
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
  const [busy, setBusy] = useState(false);
  const car = cars.find((c) => c.id === s.car) ?? cars.find((c) => c.id === "bmw_m3_e30") ?? cars[0];
  if (!car) return null;
  const skin = car.skins.includes(s.skin) ? s.skin : car.skins[0];

  async function join() {
    if (!s.ip.trim()) {
      notify("Entre l'adresse IP du serveur.", "error");
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
    <div className="columns two">
      <section className="card">
        <h2>Serveur</h2>
        <Field label="Code d'invitation (optionnel)">
          <input
            className="input"
            placeholder="NXC-…"
            onChange={(e) => {
              const parsed = parseInvite(e.target.value);
              if (parsed) setS({ ...s, ...parsed });
            }}
          />
        </Field>
        <Field label="Adresse IP">
          <input className="input" placeholder="ex. 192.168.1.20" value={s.ip} onChange={(e) => setS({ ...s, ip: e.target.value })} />
        </Field>
        <div className="row">
          <Field label="Port TCP/UDP">
            <NumberInput value={s.tcp_port} min={1} max={65535} onChange={(v) => setS({ ...s, tcp_port: v })} />
          </Field>
          <Field label="Port HTTP">
            <NumberInput value={s.http_port} min={1} max={65535} onChange={(v) => setS({ ...s, http_port: v })} />
          </Field>
        </div>
        <Field label="Mot de passe (si besoin)">
          <input className="input" type="text" value={s.password} onChange={(e) => setS({ ...s, password: e.target.value })} />
        </Field>
        <p className="muted small">Ta voiture doit faire partie de celles autorisées par le serveur.</p>
        <button className="btn primary big" disabled={busy} onClick={join}>
          {busy ? "Connexion…" : "Rejoindre la partie"}
        </button>
      </section>
      <section className="card">
        <h2>Ta voiture</h2>
        <CarPicker car={car.id} skin={skin} onChange={(c, sk) => setS({ ...s, car: c, skin: sk })} />
      </section>
    </div>
  );
}
