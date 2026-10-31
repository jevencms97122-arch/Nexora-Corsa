import { Minus, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { formatHour, weatherLabel } from "../api";
import { useContent } from "../hooks";

export function Field({ label, value, children }: { label: ReactNode; value?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">
        <span>{label}</span>
        {value !== undefined && <b>{value}</b>}
      </span>
      {children}
    </label>
  );
}

/** Champ numérique avec boutons − / +. */
export function Stepper({
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n)));
  return (
    <div className="stepper">
      <button type="button" aria-label="Diminuer" disabled={value <= min} onClick={() => onChange(clamp(value - step))}>
        <Minus size={15} />
      </button>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange(Number.isFinite(n) ? clamp(n) : min);
        }}
      />
      <button type="button" aria-label="Augmenter" disabled={value >= max} onClick={() => onChange(clamp(value + step))}>
        <Plus size={15} />
      </button>
    </div>
  );
}

/** Curseur dont la partie remplie suit la valeur. */
export function Slider({
  value,
  onChange,
  min,
  max,
  step = 1,
  scale,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  scale?: [string, string];
}) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <div>
      <input
        className="slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ "--fill": `${fill}%` } as React.CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {scale && (
        <div className="slider-scale">
          <span>{scale[0]}</span>
          <span>{scale[1]}</span>
        </div>
      )}
    </div>
  );
}

export function Switch({
  label,
  hint,
  checked,
  onChange,
}: {
  label: ReactNode;
  hint?: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="track">
        <span className="thumb" />
      </span>
      <span className="switch-text">
        {label}
        {hint && <small>{hint}</small>}
      </span>
    </label>
  );
}

export function WeatherSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { weathers } = useContent();
  return (
    <Field label="Météo">
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        {weathers.map((w) => (
          <option key={w} value={w}>
            {weatherLabel(w)}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** « 21:30 » → 21.5 ; `null` si ce n'est pas une heure valide. */
function parseHour(text: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h + min / 60 : null;
}

const QUICK_HOURS: { label: string; hour: number }[] = [
  { label: "Matin", hour: 8 },
  { label: "Midi", hour: 13 },
  { label: "Soir", hour: 18.5 },
  { label: "Nuit", hour: 23 },
];

/**
 * Heure de la session. `full` : toute la journée (00:00–23:45, saisie libre), sinon la plage 08:00–18:00 que
 * les serveurs d'origine acceptent. Le curseur avance par quarts d'heure ; le champ accepte n'importe quelle minute.
 */
export function HourSlider({ value, onChange, full }: { value: number; onChange: (v: number) => void; full?: boolean }) {
  const min = full ? 0 : 8;
  const max = full ? 23.75 : 18;
  const clamp = (h: number) => Math.min(max, Math.max(min, h));
  return (
    <div className="field">
      <span className="field-label">
        <span>Heure de la journée</span>
        {full ? (
          <input
            className="input time-input"
            type="time"
            aria-label="Heure exacte"
            value={formatHour(value)}
            onChange={(e) => {
              const h = parseHour(e.target.value);
              if (h !== null) onChange(clamp(h));
            }}
          />
        ) : (
          <b>{formatHour(value)}</b>
        )}
      </span>
      <Slider value={clamp(value)} min={min} max={max} step={full ? 0.25 : 0.5} onChange={onChange} scale={[formatHour(min), formatHour(full ? 24 : max)]} />
      {full && (
        <div className="chips">
          {QUICK_HOURS.map((q) => (
            <button key={q.label} type="button" className={`chip ${Math.abs(value - q.hour) < 0.01 ? "active" : ""}`} onClick={() => onChange(q.hour)}>
              {q.label} · {formatHour(q.hour)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
