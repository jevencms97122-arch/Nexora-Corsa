import { motion } from "motion/react";
import { useId, type ReactNode } from "react";

export interface SegOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  /** Numéro d'étape affiché dans une pastille. */
  num?: number;
  done?: boolean;
}

interface Props<T extends string> {
  options: SegOption<T>[];
  value: T;
  onChange: (v: T) => void;
  block?: boolean;
  /** Pastille active en dégradé. */
  hot?: boolean;
}

/** Contrôle segmenté dont la pastille active glisse d'une option à l'autre. */
export default function Segmented<T extends string>({ options, value, onChange, block, hot }: Props<T>) {
  const id = useId();
  return (
    <div className={`segmented ${block ? "block" : ""}`} role="tablist">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            className={`seg ${active ? "active" : ""} ${o.done && !active ? "done" : ""}`}
            onClick={() => onChange(o.value)}
          >
            {active && (
              <motion.span
                layoutId={`seg-${id}`}
                className={`seg-pill ${hot ? "hot" : ""}`}
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            )}
            {o.num !== undefined && <span className="num">{o.num}</span>}
            {o.icon}
            <span>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
