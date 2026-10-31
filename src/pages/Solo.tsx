import { AlertTriangle, ArrowLeft, ArrowRight, Bot, CarFront, Clock, CloudSun, Flag, Gauge, Map, Play, Timer } from "lucide-react";
import { useEffect, useState } from "react";
import { api, errorMessage, formatHour, weatherLabel, type SoloSettings } from "../api";
import { formatLength } from "../assets";
import { CarGrid, SkinStrip, TrackGrid } from "../components/Pickers";
import { HeroPreview, RecapLine, Specs, StepPanel } from "../components/Summary";
import { useAssistPresets, useContent, usePersisted, type Notify } from "../hooks";
import Button from "../ui/Button";
import { Field, HourSlider, Slider, Stepper, WeatherSelect } from "../ui/Fields";
import PageHeader from "../ui/PageHeader";
import Segmented from "../ui/Segmented";

type Step = "car" | "track" | "race";
const STEPS: Step[] = ["car", "track", "race"];
const SESSION_LABEL = { practice: "Essais libres", qualify: "Qualifications", race: "Course" } as const;

interface Props {
  playerName: string;
  /** Profil d'aides à la conduite choisi dans les paramètres. */
  assists: string;
  notify: Notify;
  /** Ouvre les paramètres pour changer de profil. */
  onOpenSettings: () => void;
}

export default function Solo({ playerName, assists, notify, onOpenSettings }: Props) {
  const { cars, tracks, weathers } = useContent();
  const assistName = useAssistPresets().find((p) => p.id === (assists || "gamer"))?.name ?? "…";
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
  const [step, setStep] = useState<Step>("car");
  const [busy, setBusy] = useState(false);
  // Les heures de nuit ne sont possibles qu'avec Custom Shaders Patch ; on suppose qu'il est là tant qu'on ne sait pas.
  const [cspInstalled, setCspInstalled] = useState(true);
  useEffect(() => {
    api.cspStatus().then((c) => setCspInstalled(c.installed)).catch(() => {});
  }, []);

  // Valeurs de repli quand rien n'est mémorisé ou que le contenu a changé.
  const car = cars.find((c) => c.id === s.car) ?? cars.find((c) => c.id === "bmw_m3_e30") ?? cars[0];
  const track = tracks.find((t) => t.id === s.track) ?? tracks.find((t) => t.id === "magione") ?? tracks[0];
  if (!car || !track) return <div className="page empty">Aucun contenu trouvé dans le dossier du jeu.</div>;
  const skin = car.skins.includes(s.skin) ? s.skin : car.skins[0];
  const layout = track.layouts.find((l) => l.id === s.track_config) ?? track.layouts[0];
  const weather = weathers.includes(s.weather) ? s.weather : (weathers.find((w) => w.includes("clear")) ?? weathers[0] ?? "");
  const set = (patch: Partial<SoloSettings>) => setS((p) => ({ ...p, ...patch }));
  const outsideDaylight = s.hour < 8 || s.hour > 18;
  const index = STEPS.indexOf(step);

  async function launch() {
    setBusy(true);
    try {
      await api.launchSolo({ ...s, car: car.id, skin, track: track.id, track_config: layout.id, weather, player_name: playerName });
      notify("Assetto Corsa démarre… Bonne course !");
    } catch (e) {
      notify(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  const sessionValue =
    s.session === "race" ? `${s.laps} tour${s.laps > 1 ? "s" : ""}` : `${s.duration_min} min`;

  return (
    <div className="page">
      <PageHeader
        eyebrow={<><Flag size={13} /> Hors ligne</>}
        title="Session solo"
        subtitle="Choisis ta voiture, ton circuit et les conditions, puis prends le volant."
      />
      <div className="config-layout">
        <section className="card">
          <Segmented
            block
            hot
            value={step}
            onChange={setStep}
            options={[
              { value: "car", label: "Voiture", num: 1, done: index > 0 },
              { value: "track", label: "Circuit", num: 2, done: index > 1 },
              { value: "race", label: "Conditions", num: 3 },
            ]}
          />
          <div style={{ marginTop: 20 }}>
            <StepPanel step={step}>
              {step === "car" && (
                <CarGrid selected={[car.id]} skinOf={() => skin} onPick={(c) => set({ car: c.id, skin: c.skins[0] })} />
              )}
              {step === "track" && (
                <TrackGrid selected={track.id} layout={layout.id} onPick={(t, l) => set({ track: t.id, track_config: l.id })} />
              )}
              {step === "race" && (
                <div className="stack" style={{ gap: 20 }}>
                  <Field label="Type de session">
                    <Segmented
                      block
                      value={s.session}
                      onChange={(v) => set({ session: v })}
                      options={[
                        { value: "practice", label: "Essais libres", icon: <Timer size={15} /> },
                        { value: "qualify", label: "Qualifications", icon: <Clock size={15} /> },
                        { value: "race", label: "Course", icon: <Flag size={15} /> },
                      ]}
                    />
                  </Field>
                  <div className="fields two">
                    {s.session === "race" ? (
                      <Field label="Nombre de tours">
                        <Stepper value={s.laps} min={1} max={200} onChange={(v) => set({ laps: v })} />
                      </Field>
                    ) : (
                      <Field label="Durée (minutes)">
                        <Stepper value={s.duration_min} min={1} max={600} step={5} onChange={(v) => set({ duration_min: v })} />
                      </Field>
                    )}
                    <Field label="Adversaires IA">
                      <Stepper value={s.ai_count} min={0} max={30} onChange={(v) => set({ ai_count: v })} />
                    </Field>
                  </div>
                  {s.ai_count > 0 && (
                    <Field label="Niveau des IA" value={`${s.ai_level} %`}>
                      <Slider value={s.ai_level} min={30} max={100} onChange={(v) => set({ ai_level: v })} scale={["Débutant", "Alien"]} />
                    </Field>
                  )}
                  <div className="fields two">
                    <WeatherSelect value={weather} onChange={(v) => set({ weather: v })} />
                    <Field label="Température" value={`${s.ambient_temp} °C`}>
                      <Slider value={s.ambient_temp} min={5} max={40} onChange={(v) => set({ ambient_temp: v })} scale={["5 °C", "40 °C"]} />
                    </Field>
                  </div>
                  <HourSlider full value={s.hour} onChange={(v) => set({ hour: v })} />
                  {outsideDaylight && !cspInstalled && (
                    <div className="notice warn" style={{ marginTop: -8 }}>
                      <AlertTriangle size={16} />
                      <span>
                        Sans Custom Shaders Patch, le jeu limite l'heure entre 08:00 et 18:00 : cette heure sera ramenée à la plus proche.{" "}
                        <button className="link-btn" onClick={onOpenSettings}>
                          Installer Custom Shaders Patch
                        </button>
                      </span>
                    </div>
                  )}
                </div>
              )}
            </StepPanel>
          </div>
          <div className="step-nav">
            <Button variant="ghost" icon={<ArrowLeft size={16} />} disabled={index === 0} onClick={() => setStep(STEPS[index - 1])}>
              Précédent
            </Button>
            {index < STEPS.length - 1 ? (
              <Button onClick={() => setStep(STEPS[index + 1])}>
                Suivant <ArrowRight size={16} />
              </Button>
            ) : (
              <Button variant="primary" icon={<Play size={16} fill="currentColor" />} loading={busy} onClick={launch}>
                Lancer
              </Button>
            )}
          </div>
        </section>

        <aside className="summary">
          <HeroPreview
            car={car}
            skin={skin}
            track={track}
            layout={layout.id}
            title={car.name}
            subtitle={[car.brand, layout.name].filter(Boolean).join(" · ")}
          />
          <section className="card stack">
            <SkinStrip car={car} skin={skin} onChange={(v) => set({ skin: v })} />
            <Specs car={car} />
            <div className="recap">
              <RecapLine icon={<Map size={15} />} k="Circuit" v={<>{layout.name}{layout.length && <span className="muted"> · {formatLength(layout.length)}</span>}</>} />
              <RecapLine icon={<Flag size={15} />} k={SESSION_LABEL[s.session]} v={sessionValue} />
              <RecapLine icon={<Bot size={15} />} k="Adversaires" v={s.ai_count === 0 ? "Seul en piste" : `${s.ai_count} IA · ${s.ai_level} %`} />
              <RecapLine icon={<CloudSun size={15} />} k="Météo" v={`${weatherLabel(weather)} · ${s.ambient_temp} °C`} />
              <RecapLine icon={<Clock size={15} />} k="Heure" v={formatHour(s.hour)} />
              <RecapLine
                icon={<Gauge size={15} />}
                k="Aides"
                v={
                  <button className="link-btn" title="Changer dans les paramètres" onClick={onOpenSettings}>
                    {assistName}
                  </button>
                }
              />
              <RecapLine icon={<CarFront size={15} />} k="Pilote" v={playerName} />
            </div>
            <Button variant="primary" size="lg" block shine loading={busy} icon={<Play size={18} fill="currentColor" />} onClick={launch}>
              Lancer la session
            </Button>
          </section>
        </aside>
      </div>
    </div>
  );
}
