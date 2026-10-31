import { useState } from "react";
import { api, errorMessage, type SoloSettings } from "../api";
import { Field, HourSlider, NumberInput, WeatherSelect } from "../components/Fields";
import { CarPicker, TrackPicker } from "../components/Pickers";
import { useContent, usePersisted } from "../hooks";

interface Props {
  playerName: string;
  notify: (msg: string, kind?: "ok" | "error") => void;
}

export default function Solo({ playerName, notify }: Props) {
  const { cars, tracks, weathers } = useContent();
  const [s, setS] = usePersisted<SoloSettings>("nexora.solo", {
    car: "",
    skin: "",
    track: "",
    track_config: "",
    player_name: "",
    ai_count: 0,
    ai_level: 90,
    weather: "",
    hour: 14,
    session: "practice",
    duration_min: 30,
    laps: 5,
    ambient_temp: 22,
  });
  const [busy, setBusy] = useState(false);

  // Valeurs de repli quand rien n'est mémorisé ou que le contenu a changé.
  const car = cars.find((c) => c.id === s.car) ?? cars.find((c) => c.id === "bmw_m3_e30") ?? cars[0];
  const track = tracks.find((t) => t.id === s.track) ?? tracks.find((t) => t.id === "magione") ?? tracks[0];
  if (!car || !track) return <div className="muted">Aucun contenu trouvé dans le dossier du jeu.</div>;
  const skin = car.skins.includes(s.skin) ? s.skin : car.skins[0];
  const layout = track.layouts.some((l) => l.id === s.track_config) ? s.track_config : track.layouts[0].id;
  const weather = weathers.includes(s.weather) ? s.weather : (weathers.find((w) => w.includes("clear")) ?? weathers[0] ?? "");
  const set = (patch: Partial<SoloSettings>) => setS((p) => ({ ...p, ...patch }));

  async function launch() {
    setBusy(true);
    try {
      await api.launchSolo({ ...s, car: car.id, skin, track: track.id, track_config: layout, weather, player_name: playerName });
      notify("Assetto Corsa démarre…");
    } catch (e) {
      notify(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <h1>Session solo</h1>
      <div className="columns">
        <section className="card">
          <h2>Voiture</h2>
          <CarPicker car={car.id} skin={skin} onChange={(c, sk) => set({ car: c, skin: sk })} />
        </section>
        <section className="card">
          <h2>Circuit</h2>
          <TrackPicker track={track.id} layout={layout} onChange={(t, l) => set({ track: t, track_config: l })} />
        </section>
        <section className="card options">
          <h2>Session</h2>
          <Field label="Type">
            <select className="input" value={s.session} onChange={(e) => set({ session: e.target.value as SoloSettings["session"] })}>
              <option value="practice">Essais libres</option>
              <option value="qualify">Qualifications</option>
              <option value="race">Course</option>
            </select>
          </Field>
          {s.session === "race" ? (
            <Field label="Tours">
              <NumberInput value={s.laps} min={1} max={200} onChange={(v) => set({ laps: v })} />
            </Field>
          ) : (
            <Field label="Durée (min)">
              <NumberInput value={s.duration_min} min={1} max={600} onChange={(v) => set({ duration_min: v })} />
            </Field>
          )}
          <Field label="Adversaires IA">
            <NumberInput value={s.ai_count} min={0} max={30} onChange={(v) => set({ ai_count: v })} />
          </Field>
          {s.ai_count > 0 && (
            <Field label={`Niveau IA : ${s.ai_level}%`}>
              <input type="range" min={30} max={100} value={s.ai_level} onChange={(e) => set({ ai_level: Number(e.target.value) })} />
            </Field>
          )}
          <WeatherSelect value={weather} onChange={(v) => set({ weather: v })} />
          <HourSlider value={s.hour} onChange={(v) => set({ hour: v })} />
          <Field label={`Température : ${s.ambient_temp}°C`}>
            <input type="range" min={5} max={40} value={s.ambient_temp} onChange={(e) => set({ ambient_temp: Number(e.target.value) })} />
          </Field>
          <button className="btn primary big" disabled={busy} onClick={launch}>
            {busy ? "Lancement…" : "▶ Lancer la session"}
          </button>
        </section>
      </div>
    </div>
  );
}
