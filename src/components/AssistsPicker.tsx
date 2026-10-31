import { motion } from "motion/react";
import { Check } from "lucide-react";
import type { AssistPreset } from "../api";

type Tone = "easy" | "mid" | "real";

interface Row {
  label: string;
  value: string;
  tone: Tone;
}

const yesNo = (on: boolean): Pick<Row, "value" | "tone"> => ({ value: on ? "Oui" : "Non", tone: on ? "easy" : "real" });
const level = (n: number): Pick<Row, "value" | "tone"> =>
  n === 2 ? { value: "Activé", tone: "easy" } : n === 1 ? { value: "D'origine", tone: "real" } : { value: "Désactivé", tone: "real" };

/** Lignes affichées pour un profil, avec une teinte : vert = conduite réaliste, orange / rouge = assisté. */
function rows(p: AssistPreset): Row[] {
  return [
    { label: "Ligne idéale", ...yesNo(p.ideal_line) },
    { label: "Boîte automatique", ...yesNo(p.auto_shifter) },
    { label: "Embrayage automatique", ...yesNo(p.auto_clutch) },
    { label: "Auto-blip", ...yesNo(p.auto_blip) },
    { label: "ABS", ...level(p.abs) },
    { label: "Anti-patinage", ...level(p.traction_control) },
    {
      label: "Contrôle de stabilité",
      value: `${p.stability_control} %`,
      tone: p.stability_control === 0 ? "real" : p.stability_control >= 100 ? "easy" : "mid",
    },
    { label: "Carburant", value: `${p.fuel_rate}×`, tone: p.fuel_rate >= 1 ? "real" : "mid" },
    { label: "Usure des pneus", value: `${p.tyre_wear}×`, tone: p.tyre_wear >= 1 ? "real" : "mid" },
  ];
}

interface Props {
  presets: AssistPreset[];
  value: string;
  onChange: (id: AssistPreset["id"]) => void;
}

/** Les trois profils d'aides du jeu (Gamer / Intermédiaire / Pro), avec le détail de chaque réglage. */
export default function AssistsPicker({ presets, value, onChange }: Props) {
  if (presets.length === 0) {
    return (
      <div className="assist-grid">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton" style={{ height: 380, borderRadius: 16 }} />
        ))}
      </div>
    );
  }
  return (
    <div className="assist-grid" role="radiogroup" aria-label="Profil d'aides à la conduite">
      {presets.map((p, i) => {
        const active = p.id === value;
        return (
          <motion.button
            key={p.id}
            role="radio"
            aria-checked={active}
            className={`assist-card ${active ? "selected" : ""}`}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.07, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            whileTap={{ scale: 0.985 }}
            onClick={() => onChange(p.id)}
          >
            <div className="assist-head">
              <div>
                <div className="assist-name">{p.name}</div>
                <div className="muted tiny">{p.tagline}</div>
              </div>
              <span className="assist-check">
                <motion.span initial={false} animate={{ scale: active ? 1 : 0, opacity: active ? 1 : 0 }} transition={{ type: "spring", stiffness: 500, damping: 26 }}>
                  <Check size={15} strokeWidth={3} />
                </motion.span>
              </span>
            </div>
            <div className="assist-rows">
              {rows(p).map((r) => (
                <div key={r.label} className="assist-row">
                  <span>{r.label}</span>
                  <b className={`tone-${r.tone}`}>{r.value}</b>
                </div>
              ))}
            </div>
          </motion.button>
        );
      })}
    </div>
  );
}
