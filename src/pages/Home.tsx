import {
  ArrowRight,
  CarFront,
  Flag,
  History as HistoryIcon,
  LogIn,
  Map,
  Package,
  Play,
  RotateCcw,
  Server,
  Store,
  Trophy,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, errorMessage, type HistoryEntry, type ServerStatus, type SoloSettings } from "../api";
import { carPreview } from "../assets";
import CspCard from "../components/CspCard";
import { useContent, type Notify } from "../hooks";
import Button from "../ui/Button";
import Img from "../ui/Img";
import { CountUp, Item, Stagger } from "../ui/motion";
import { CardTitle } from "../ui/PageHeader";
import type { Page } from "../App";

interface Props {
  active: boolean;
  playerName: string;
  notify: Notify;
  go: (page: Page, onlineTab?: "host" | "join") => void;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 6) return "Encore debout";
  if (h < 12) return "Bonjour";
  if (h < 18) return "Prêt à rouler";
  return "Bonsoir";
}

function lastSolo(): Partial<SoloSettings> {
  try {
    return JSON.parse(localStorage.getItem("nexora.solo") ?? "{}");
  } catch {
    return {};
  }
}

export default function Home({ active, playerName, notify, go }: Props) {
  const { acPath, cars, tracks } = useContent();
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [mods, setMods] = useState(0);
  const [server, setServer] = useState<ServerStatus | null>(null);

  useEffect(() => {
    if (!active) return;
    api.getHistory().then(setHistory).catch(() => {});
    api.listMods().then((m) => setMods(m.length)).catch(() => {});
    api.serverStatus().then(setServer).catch(() => {});
  }, [active]);

  // Image de fond : la dernière voiture choisie en solo, sinon une voiture au hasard (fixée pour la session).
  const heroCar = useMemo(() => {
    const saved = lastSolo();
    const car = cars.find((c) => c.id === saved.car) ?? cars[Math.floor(Math.random() * Math.max(1, cars.length))];
    if (!car) return null;
    return { car, skin: saved.skin && car.skins.includes(saved.skin) ? saved.skin : car.skins[0] };
  }, [cars]);

  const lastReplay = history.find((h) => h.solo);
  const lastTrack = lastReplay ? tracks.find((t) => t.id === lastReplay.track) : undefined;

  async function replay() {
    if (!lastReplay?.solo) return;
    try {
      await api.launchSolo(lastReplay.solo);
      notify("Assetto Corsa démarre… Bonne course !");
    } catch (e) {
      notify(errorMessage(e), "error");
    }
  }

  const quick = [
    { title: "Session solo", sub: "Voiture, circuit, IA", icon: <Flag size={20} />, onClick: () => go("solo"), tint: "255, 90, 31" },
    { title: "Créer une partie", sub: "Serveur prêt en 1 clic", icon: <Server size={20} />, onClick: () => go("online", "host"), tint: "167, 139, 250" },
    { title: "Rejoindre", sub: "Avec un code d'invitation", icon: <LogIn size={20} />, onClick: () => go("online", "join"), tint: "46, 230, 197" },
    { title: "Garage", sub: "Trouver de nouveaux mods", icon: <Store size={20} />, onClick: () => go("garage"), tint: "251, 191, 36" },
  ];

  const stats = [
    { k: "Voitures", v: cars.length, icon: <CarFront size={13} />, max: 400 },
    { k: "Circuits", v: tracks.length, icon: <Map size={13} />, max: 80 },
    { k: "Mods installés", v: mods, icon: <Package size={13} />, max: 40 },
    { k: "Sessions jouées", v: history.length, icon: <Trophy size={13} />, max: 100 },
  ];

  return (
    <div className="page">
      <Stagger>
        <Item>
          <section className="home-hero">
            <div className="bg">{heroCar && <Img srcs={carPreview(acPath, heroCar.car.id, heroCar.skin)} />}</div>
            <div className="veil" />
            <div className="content">
              <div className="eyebrow">
                <Flag size={13} /> Nexora-Corsa
              </div>
              <h1>
                {greeting()},<br />
                <span className="grad-text">{playerName}</span>
              </h1>
              <p>
                {lastReplay
                  ? `Dernière session : ${cars.find((c) => c.id === lastReplay.car)?.name ?? lastReplay.car}${lastTrack ? ` à ${lastTrack.name}` : ""}.`
                  : "Choisis une voiture, un circuit, et c'est parti."}
              </p>
              <div className="row wrap">
                {lastReplay ? (
                  <Button variant="primary" size="lg" shine icon={<RotateCcw size={18} />} onClick={replay}>
                    Reprendre la dernière session
                  </Button>
                ) : (
                  <Button variant="primary" size="lg" shine icon={<Play size={18} fill="currentColor" />} onClick={() => go("solo")}>
                    Prendre le volant
                  </Button>
                )}
                <Button size="lg" icon={<Server size={18} />} onClick={() => go("online", "host")}>
                  Jouer entre amis
                </Button>
              </div>
            </div>
          </section>
        </Item>

        <Item>
          <CspCard variant="banner" notify={notify} />
        </Item>

        <Item className="quick-grid">
          {quick.map((q) => (
            <button
              key={q.title}
              className="quick"
              onClick={q.onClick}
              style={
                {
                  "--tint": `rgba(${q.tint}, 0.2)`,
                  "--tint-bg": `rgba(${q.tint}, 0.14)`,
                  "--tint-fg": `rgb(${q.tint})`,
                } as React.CSSProperties
              }
            >
              <span className="q-icon">{q.icon}</span>
              <span>
                <div className="q-title">{q.title}</div>
                <div className="q-sub">{q.sub}</div>
              </span>
              <ArrowRight size={18} className="quick-arrow" />
            </button>
          ))}
        </Item>

        <Item className="stats">
          {stats.map((s) => (
            <div key={s.k} className="card stat">
              <div className="v">
                <CountUp to={s.v} />
              </div>
              <div className="k">
                {s.icon} {s.k}
              </div>
              <div className="bar">
                <span style={{ width: `${Math.min(100, (s.v / s.max) * 100)}%`, transition: "width 1.2s cubic-bezier(.22,1,.36,1)" }} />
              </div>
            </div>
          ))}
        </Item>

        <Item className="two-col">
          <section className="card">
            <CardTitle
              icon={<HistoryIcon size={16} />}
              right={
                <button className="btn ghost sm" onClick={() => go("history")}>
                  Tout voir <ArrowRight size={14} />
                </button>
              }
            >
              Dernières sessions
            </CardTitle>
            {history.length === 0 ? (
              <div className="empty">
                <div className="empty-icon">
                  <Flag size={24} />
                </div>
                Tes sessions apparaîtront ici.
              </div>
            ) : (
              <div className="list">
                {history.slice(0, 4).map((h) => {
                  const car = cars.find((c) => c.id === h.car.split(", ")[0]);
                  const track = tracks.find((t) => t.id === h.track);
                  return (
                    <div className="list-row" key={`${h.ts}-${h.kind}`}>
                      <div className="thumb">{car && <Img srcs={carPreview(acPath, car.id, car.skins[0])} />}</div>
                      <div className="grow">
                        <div className="title ellipsis">{car?.name ?? h.car}</div>
                        <div className="sub ellipsis">{[track?.name, h.detail].filter(Boolean).join(" · ")}</div>
                      </div>
                      <span className="muted small">
                        {new Date(h.ts * 1000).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="card">
            <CardTitle icon={<Server size={16} />}>Ton serveur</CardTitle>
            {server?.running ? (
              <div className="stack">
                <div className="row">
                  <span className="live-dot" />
                  <div className="grow">
                    <div style={{ fontWeight: 700 }}>{server.name}</div>
                    <div className="muted small">En ligne · port {server.tcp_port}</div>
                  </div>
                </div>
                <Button variant="primary" icon={<ArrowRight size={16} />} onClick={() => go("online", "host")}>
                  Gérer le serveur
                </Button>
              </div>
            ) : (
              <div className="stack">
                <p className="muted small" style={{ margin: 0 }}>
                  Aucun serveur en cours. Crée-en un : les ports s'ouvrent tout seuls et tu reçois un code à partager.
                </p>
                <Button icon={<Server size={16} />} onClick={() => go("online", "host")}>
                  Créer une partie
                </Button>
              </div>
            )}
          </section>
        </Item>
      </Stagger>
    </div>
  );
}
