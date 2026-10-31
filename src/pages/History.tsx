import { AnimatePresence, motion } from "motion/react";
import { Flag, History as HistoryIcon, LogIn, RotateCcw, Server, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, errorMessage, type HistoryEntry } from "../api";
import { carPreview, trackPreview } from "../assets";
import { useContent, type Notify } from "../hooks";
import Button from "../ui/Button";
import Img from "../ui/Img";
import PageHeader from "../ui/PageHeader";

interface Props {
  active: boolean;
  notify: Notify;
}

const KIND = {
  solo: { label: "Solo", icon: <Flag size={16} /> },
  join: { label: "Rejoint", icon: <LogIn size={16} /> },
  host: { label: "Hébergé", icon: <Server size={16} /> },
} as const;

function dayLabel(ts: number): string {
  const d = new Date(ts * 1000);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Aujourd'hui";
  if (d.toDateString() === yesterday.toDateString()) return "Hier";
  return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
}

export default function History({ active, notify }: Props) {
  const { acPath, cars, tracks } = useContent();
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    if (active) api.getHistory().then(setEntries).catch(() => setEntries([]));
  }, [active]);

  const groups = useMemo(() => {
    const out: { day: string; items: HistoryEntry[] }[] = [];
    for (const e of entries ?? []) {
      const day = dayLabel(e.ts);
      const last = out[out.length - 1];
      if (last?.day === day) last.items.push(e);
      else out.push({ day, items: [e] });
    }
    return out;
  }, [entries]);

  const carName = (ids: string) =>
    ids
      .split(", ")
      .map((id) => cars.find((c) => c.id === id)?.name ?? id)
      .join(", ");
  const thumb = (e: HistoryEntry) => {
    const firstCar = cars.find((c) => c.id === e.car.split(", ")[0]);
    if (firstCar) return carPreview(acPath, firstCar.id, e.solo?.skin && firstCar.skins.includes(e.solo.skin) ? e.solo.skin : firstCar.skins[0]);
    const track = tracks.find((t) => t.id === e.track);
    return track ? trackPreview(acPath, track.id, track.layouts[0].id) : [];
  };

  async function replay(e: HistoryEntry) {
    if (!e.solo) return;
    try {
      await api.launchSolo(e.solo);
      notify("Assetto Corsa démarre… Bonne course !");
      api.getHistory().then(setEntries);
    } catch (err) {
      notify(errorMessage(err), "error");
    }
  }

  async function clear() {
    await api.clearHistory();
    setEntries([]);
    setConfirmClear(false);
  }

  let index = 0;
  return (
    <div className="page">
      <PageHeader
        eyebrow={<><HistoryIcon size={13} /> Journal</>}
        title="Historique"
        subtitle="Tes dernières sessions. Relance une session solo en un clic."
        actions={
          entries && entries.length > 0 ? (
            confirmClear ? (
              <>
                <Button variant="danger" size="sm" onClick={clear}>Tout effacer</Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmClear(false)}>Annuler</Button>
              </>
            ) : (
              <Button variant="ghost" size="sm" icon={<Trash2 size={14} />} onClick={() => setConfirmClear(true)}>
                Vider
              </Button>
            )
          ) : undefined
        }
      />
      <section className="card">
        {entries === null && (
          <div className="stack">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton" style={{ height: 62 }} />
            ))}
          </div>
        )}
        {entries?.length === 0 && (
          <div className="empty">
            <div className="empty-icon">
              <HistoryIcon size={24} />
            </div>
            Aucune session lancée pour l'instant.
          </div>
        )}
        {groups.length > 0 && (
          <div className="timeline">
            <AnimatePresence>
              {groups.map((g) => (
                <div key={g.day}>
                  <div className="timeline-day">{g.day}</div>
                  {g.items.map((e) => {
                    const i = index++;
                    const track = tracks.find((t) => t.id === e.track);
                    return (
                      <motion.div
                        key={`${e.ts}-${e.kind}`}
                        className="timeline-item"
                        initial={{ opacity: 0, x: -12 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: Math.min(i, 12) * 0.04, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                      >
                        <div className="list-row">
                          <div className="thumb">
                            <Img srcs={thumb(e)} />
                          </div>
                          <div className="grow">
                            <div className="title ellipsis">{carName(e.car)}</div>
                            <div className="sub ellipsis">
                              {[track?.name ?? e.track, e.detail].filter(Boolean).join(" · ")}
                            </div>
                          </div>
                          <span className={`tag ${e.kind === "solo" ? "accent" : e.kind === "join" ? "cyan" : ""}`}>
                            {KIND[e.kind].icon} {KIND[e.kind].label}
                          </span>
                          <span className="muted small" style={{ width: 48, textAlign: "right" }}>
                            {new Date(e.ts * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                          {e.solo ? (
                            <Button size="sm" icon={<RotateCcw size={14} />} onClick={() => replay(e)}>
                              Relancer
                            </Button>
                          ) : (
                            <span style={{ width: 98 }} />
                          )}
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </section>
    </div>
  );
}
