import { useEffect, useState } from "react";
import { api, errorMessage, type HistoryEntry } from "../api";
import { useContent } from "../hooks";

interface Props {
  notify: (msg: string, kind?: "ok" | "error") => void;
}

const KIND_LABEL = { solo: "Solo", join: "Rejoint", host: "Hébergé" } as const;

export default function History({ notify }: Props) {
  const { cars, tracks } = useContent();
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);

  useEffect(() => {
    api.getHistory().then(setEntries).catch(() => setEntries([]));
  }, []);

  const carName = (ids: string) =>
    ids
      .split(", ")
      .map((id) => cars.find((c) => c.id === id)?.name ?? id)
      .join(", ");
  const trackName = (id: string) => tracks.find((t) => t.id === id)?.name ?? id;

  async function replay(e: HistoryEntry) {
    if (!e.solo) return;
    try {
      await api.launchSolo(e.solo);
      notify("Assetto Corsa démarre…");
      api.getHistory().then(setEntries);
    } catch (err) {
      notify(errorMessage(err), "error");
    }
  }

  async function clear() {
    await api.clearHistory();
    setEntries([]);
  }

  return (
    <div className="page">
      <h1>Historique</h1>
      <section className="card">
        {entries === null && <p className="muted">Chargement…</p>}
        {entries?.length === 0 && <p className="muted">Aucune session lancée pour l'instant.</p>}
        {entries?.map((e) => (
          <div className="chosen-row history-row" key={`${e.ts}-${e.kind}`}>
            <span className="tag">{KIND_LABEL[e.kind]}</span>
            <span className="grow">
              <b>{carName(e.car)}</b>
              {e.track && <> · {trackName(e.track)}</>}
              <span className="muted small"> — {e.detail}</span>
            </span>
            <span className="muted small">{new Date(e.ts * 1000).toLocaleString("fr-FR")}</span>
            {e.solo && (
              <button className="btn small-btn" onClick={() => replay(e)}>
                Relancer
              </button>
            )}
          </div>
        ))}
        {entries && entries.length > 0 && (
          <button className="btn small-btn" onClick={clear}>
            Vider l'historique
          </button>
        )}
      </section>
    </div>
  );
}
