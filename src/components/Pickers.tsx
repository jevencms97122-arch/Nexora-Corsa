import { useMemo, useState } from "react";
import { api } from "../api";
import { useContent, useImage } from "../hooks";

interface CarPickerProps {
  car: string;
  skin: string;
  onChange: (car: string, skin: string) => void;
}

export function CarPicker({ car, skin, onChange }: CarPickerProps) {
  const { cars } = useContent();
  const [query, setQuery] = useState("");
  const selected = cars.find((c) => c.id === car);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? cars.filter((c) => `${c.brand} ${c.name}`.toLowerCase().includes(q)) : cars;
  }, [cars, query]);
  const preview = useImage(selected && skin ? () => api.carPreview(selected.id, skin) : null, [car, skin]);

  return (
    <div className="picker">
      <div className="preview">
        {preview ? <img src={preview} alt="" /> : <span className="muted">Aperçu</span>}
      </div>
      <input
        className="input"
        placeholder={`Rechercher parmi ${cars.length} voitures…`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="list">
        {filtered.map((c) => (
          <button
            key={c.id}
            className={`list-item ${c.id === car ? "active" : ""}`}
            onClick={() => onChange(c.id, c.skins[0])}
          >
            {c.name}
          </button>
        ))}
        {filtered.length === 0 && <div className="muted pad">Aucune voiture trouvée.</div>}
      </div>
      {selected && (
        <label className="field">
          Livrée
          <select className="input" value={skin} onChange={(e) => onChange(car, e.target.value)}>
            {selected.skins.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

interface TrackPickerProps {
  track: string;
  layout: string;
  onChange: (track: string, layout: string) => void;
}

export function TrackPicker({ track, layout, onChange }: TrackPickerProps) {
  const { tracks } = useContent();
  const [query, setQuery] = useState("");
  const selected = tracks.find((t) => t.id === track);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? tracks.filter((t) => t.name.toLowerCase().includes(q)) : tracks;
  }, [tracks, query]);
  const preview = useImage(selected ? () => api.trackPreview(selected.id, layout) : null, [track, layout]);

  return (
    <div className="picker">
      <div className="preview">
        {preview ? <img className="contain" src={preview} alt="" /> : <span className="muted">Aperçu</span>}
      </div>
      <input
        className="input"
        placeholder={`Rechercher parmi ${tracks.length} circuits…`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="list">
        {filtered.map((t) => (
          <button
            key={t.id}
            className={`list-item ${t.id === track ? "active" : ""}`}
            onClick={() => onChange(t.id, t.layouts[0].id)}
          >
            {t.name}
          </button>
        ))}
      </div>
      {selected && selected.layouts.length > 1 && (
        <label className="field">
          Configuration
          <select className="input" value={layout} onChange={(e) => onChange(track, e.target.value)}>
            {selected.layouts.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
