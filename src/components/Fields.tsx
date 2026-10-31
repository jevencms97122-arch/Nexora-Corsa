import type { ReactNode } from "react";
import { formatHour, weatherLabel } from "../api";
import { useContent } from "../hooks";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      {label}
      {children}
    </label>
  );
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
}) {
  return (
    <input
      className="input"
      type="number"
      min={min}
      max={max}
      value={value}
      onChange={(e) => {
        const n = Number(e.target.value);
        onChange(Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : min);
      }}
    />
  );
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function WeatherSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { weathers } = useContent();
  return (
    <Field label="Météo">
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {weathers.map((w) => (
          <option key={w} value={w}>
            {weatherLabel(w)}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function HourSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <Field label={`Heure : ${formatHour(value)}`}>
      <input
        type="range"
        min={8}
        max={18}
        step={0.5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </Field>
  );
}
