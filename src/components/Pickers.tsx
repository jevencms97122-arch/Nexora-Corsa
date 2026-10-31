import { Check, Layers, Search, SearchX } from "lucide-react";
import { useMemo, useState } from "react";
import type { Car, CarOrigin, Track, TrackLayout } from "../api";
import { carPreview, formatLength, skinSwatch, trackPreview } from "../assets";
import { useContent } from "../hooks";
import Img from "../ui/Img";
import Segmented, { type SegOption } from "../ui/Segmented";
import LayoutDialog from "./LayoutDialog";

const PAGE = 48;

const CLASS_LABEL: Record<string, string> = { street: "Route", race: "Course", drift: "Drift" };

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="input-icon">
      <Search size={17} />
      <input className="input" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function MoreButton({ shown, total, onMore }: { shown: number; total: number; onMore: () => void }) {
  if (shown >= total) return null;
  return (
    <div className="center" style={{ marginTop: 16 }}>
      <button className="btn" onClick={onMore}>
        Afficher plus ({total - shown} restantes)
      </button>
    </div>
  );
}

function NoResult({ what }: { what: string }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <SearchX size={24} />
      </div>
      Aucun{what === "voiture" ? "e" : ""} {what} ne correspond à ta recherche.
    </div>
  );
}

interface CarGridProps {
  /** Voitures sélectionnées (une seule en solo, plusieurs pour un serveur). */
  selected: string[];
  onPick: (car: Car) => void;
  /** Livrée affichée pour une voiture sélectionnée. */
  skinOf?: (id: string) => string | undefined;
  compact?: boolean;
}

export function CarGrid({ selected, onPick, skinOf, compact }: CarGridProps) {
  const { acPath, cars } = useContent();
  const [query, setQuery] = useState("");
  const [klass, setKlass] = useState("all");
  const [brand, setBrand] = useState("");
  const [origin, setOrigin] = useState<"all" | CarOrigin>("all");
  const [pack, setPack] = useState("");
  const [limit, setLimit] = useState(PAGE);

  const counts = useMemo(() => {
    const n = { all: cars.length, base: 0, dlc: 0, mod: 0 };
    for (const c of cars) n[c.origin] += 1;
    return n;
  }, [cars]);
  const packs = useMemo(
    () => [...new Set(cars.filter((c) => c.origin === "dlc").map((c) => c.pack))].sort((a, b) => a.localeCompare(b)),
    [cars],
  );
  const originOptions: SegOption<"all" | CarOrigin>[] = [
    { value: "all", label: <>Toutes <span className="count">{counts.all}</span></> },
    { value: "base", label: <>Jeu de base <span className="count">{counts.base}</span></> },
    { value: "dlc", label: <>DLC <span className="count">{counts.dlc}</span></> },
    { value: "mod", label: <>Mods <span className="count">{counts.mod}</span></> },
  ].filter((o) => o.value === "all" || counts[o.value as CarOrigin] > 0) as SegOption<"all" | CarOrigin>[];

  const brands = useMemo(() => [...new Set(cars.map((c) => c.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [cars]);
  const classes = useMemo(() => {
    const set = new Set(cars.map((c) => c.class).filter((c) => c in CLASS_LABEL));
    if (cars.some((c) => c.id.includes("drift"))) set.add("drift");
    return ["all", ...[...set].sort()];
  }, [cars]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return cars.filter(
      (c) =>
        (!q || `${c.brand} ${c.name} ${c.id}`.toLowerCase().includes(q)) &&
        (!brand || c.brand === brand) &&
        (origin === "all" || c.origin === origin) &&
        (origin !== "dlc" || !pack || c.pack === pack) &&
        (klass === "all" || (klass === "drift" ? c.id.includes("drift") : c.class === klass)),
    );
  }, [cars, query, brand, origin, pack, klass]);

  const reset = () => setLimit(PAGE);

  return (
    <div>
      <div className="picker-toolbar">
        <div className="row">
          <div className="grow">
            <SearchBox
              value={query}
              onChange={(v) => {
                setQuery(v);
                reset();
              }}
              placeholder={`Rechercher parmi ${cars.length} voitures…`}
            />
          </div>
          <select
            className="select"
            style={{ width: 190 }}
            value={brand}
            onChange={(e) => {
              setBrand(e.target.value);
              reset();
            }}
          >
            <option value="">Toutes les marques</option>
            {brands.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </div>
        {originOptions.length > 1 && (
          <div className="row wrap">
            <Segmented
              value={origin}
              onChange={(v) => {
                setOrigin(v);
                setPack("");
                reset();
              }}
              options={originOptions}
            />
            {origin === "dlc" && (
              <select
                className="select"
                style={{ width: 210 }}
                value={pack}
                onChange={(e) => {
                  setPack(e.target.value);
                  reset();
                }}
              >
                <option value="">Tous les packs DLC</option>
                {packs.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            )}
          </div>
        )}
        <div className="row">
          <div className="chips grow">
            {classes.map((c) => (
              <button
                key={c}
                className={`chip ${klass === c ? "active" : ""}`}
                onClick={() => {
                  setKlass(c);
                  reset();
                }}
              >
                {c === "all" ? "Toutes" : CLASS_LABEL[c]}
              </button>
            ))}
          </div>
          <span className="muted small">{filtered.length} résultat(s)</span>
        </div>
      </div>

      {filtered.length === 0 ? (
        <NoResult what="voiture" />
      ) : (
        <div className={`media-grid ${compact ? "compact" : ""}`}>
          {filtered.slice(0, limit).map((c, i) => {
            const isSel = selected.includes(c.id);
            const skin = (isSel && skinOf?.(c.id)) || c.skins[0];
            return (
              <button
                key={c.id}
                className={`media-card ${isSel ? "selected" : ""}`}
                style={{ "--i": i % PAGE } as React.CSSProperties}
                onClick={() => onPick(c)}
                title={c.name}
              >
                <Img srcs={carPreview(acPath, c.id, skin)} />
                {c.origin !== "base" && (
                  <span className="corner tag" title={c.origin === "dlc" ? c.pack : "Mod"}>
                    {c.origin === "dlc" ? "DLC" : "MOD"}
                  </span>
                )}
                {isSel && (
                  <span className="check">
                    <Check size={15} strokeWidth={3} />
                  </span>
                )}
                <div className="meta">
                  <span className="name ellipsis">{c.name}</span>
                  <span className="sub ellipsis">
                    {[c.brand, c.bhp].filter(Boolean).join(" · ") || " "}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
      <MoreButton shown={Math.min(limit, filtered.length)} total={filtered.length} onMore={() => setLimit((l) => l + PAGE)} />
    </div>
  );
}

interface TrackGridProps {
  selected: string;
  /** Configuration retenue pour le circuit sélectionné. */
  layout: string;
  onPick: (track: Track, layout: TrackLayout) => void;
}

export function TrackGrid({ selected, layout, onPick }: TrackGridProps) {
  const { acPath, tracks } = useContent();
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  // Circuit dont la fenêtre des configurations est ouverte.
  const [choosing, setChoosing] = useState<Track | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? tracks.filter((t) => `${t.name} ${t.id} ${t.layouts.map((l) => `${l.name} ${l.country}`).join(" ")}`.toLowerCase().includes(q))
      : tracks;
  }, [tracks, query]);

  return (
    <div>
      <div className="picker-toolbar">
        <div className="row">
          <div className="grow">
            <SearchBox
              value={query}
              onChange={(v) => {
                setQuery(v);
                setLimit(PAGE);
              }}
              placeholder={`Rechercher parmi ${tracks.length} circuits…`}
            />
          </div>
          <span className="muted small">{filtered.length} résultat(s)</span>
        </div>
      </div>
      {filtered.length === 0 ? (
        <NoResult what="circuit" />
      ) : (
        <div className="media-grid">
          {filtered.slice(0, limit).map((t, i) => {
            const isSel = t.id === selected;
            // Pour le circuit retenu on montre la configuration choisie, sinon la première.
            const shown = (isSel && t.layouts.find((l) => l.id === layout)) || t.layouts[0];
            const multi = t.layouts.length > 1;
            return (
              <button
                key={t.id}
                className={`media-card ${isSel ? "selected" : ""}`}
                style={{ "--i": i % PAGE } as React.CSSProperties}
                // Plusieurs configurations : on ouvre la fenêtre de choix, sinon on sélectionne directement.
                onClick={() => (multi ? setChoosing(t) : onPick(t, t.layouts[0]))}
                title={multi ? `${t.name} : choisir une configuration` : t.name}
              >
                <Img srcs={trackPreview(acPath, t.id, shown.id)} />
                {multi && (
                  <span className="corner tag">
                    <Layers size={11} /> {t.layouts.length} configs
                  </span>
                )}
                {isSel && (
                  <span className="check">
                    <Check size={15} strokeWidth={3} />
                  </span>
                )}
                <div className="meta">
                  <span className="name ellipsis">{t.name}</span>
                  <span className="sub ellipsis">
                    {(isSel && multi ? [shown.label || shown.name, formatLength(shown.length)] : [shown.country, formatLength(shown.length)])
                      .filter(Boolean)
                      .join(" · ") ||" "}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
      <MoreButton shown={Math.min(limit, filtered.length)} total={filtered.length} onMore={() => setLimit((l) => l + PAGE)} />
      <LayoutDialog
        track={choosing}
        currentTrack={selected}
        currentLayout={layout}
        onClose={() => setChoosing(null)}
        onPick={(t, l) => {
          onPick(t, l);
          setChoosing(null);
        }}
      />
    </div>
  );
}

/** Bandeau des livrées d'une voiture, avec leurs pastilles. */
export function SkinStrip({ car, skin, onChange }: { car: Car; skin: string; onChange: (s: string) => void }) {
  const { acPath } = useContent();
  return (
    <div>
      <div className="field-label" style={{ marginBottom: 6 }}>
        <span>Livrée ({car.skins.length})</span>
        <span className="muted small ellipsis" style={{ maxWidth: 200 }}>
          {skin.replace(/_/g, " ")}
        </span>
      </div>
      <div className="swatches">
        {car.skins.map((s) => (
          <button key={s} className={`swatch ${s === skin ? "active" : ""}`} title={s} onClick={() => onChange(s)}>
            <Img srcs={skinSwatch(acPath, car.id, s)} />
          </button>
        ))}
      </div>
    </div>
  );
}
