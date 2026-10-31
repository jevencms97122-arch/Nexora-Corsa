import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import type { Car, Track } from "../api";
import { carPreview, trackOutline } from "../assets";
import { useContent } from "../hooks";
import Img from "../ui/Img";

/** Grande vignette de la voiture choisie (fondu enchaîné à chaque changement) avec le tracé du circuit. */
export function HeroPreview({ car, skin, track, layout, title, subtitle }: {
  car?: Car;
  skin?: string;
  track?: Track;
  layout?: string;
  title: ReactNode;
  subtitle?: ReactNode;
}) {
  const { acPath } = useContent();
  const key = car && skin ? `${car.id}/${skin}` : "none";
  return (
    <div className="hero-preview">
      <AnimatePresence initial={false}>
        <motion.div
          key={key}
          className="layer"
          initial={{ opacity: 0, scale: 1.06 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        >
          {car && skin && <Img srcs={carPreview(acPath, car.id, skin)} />}
        </motion.div>
      </AnimatePresence>
      {track && (
        <motion.div key={`${track.id}/${layout}`} className="outline" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 0.85, y: 0 }}>
          <Img srcs={trackOutline(acPath, track.id, layout ?? "")} contain quietFallback />
        </motion.div>
      )}
      <div className="shade" />
      <div className="caption">
        <AnimatePresence mode="wait">
          <motion.div key={String(title)} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.25 }}>
            <div className="title">{title}</div>
            {subtitle && <div className="sub">{subtitle}</div>}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

export function Specs({ car }: { car: Car }) {
  const items = [
    ["Puissance", car.bhp],
    ["Poids", car.weight],
    ["V. max", car.top_speed],
  ].filter(([, v]) => v);
  if (items.length === 0) return null;
  return (
    <div className="spec-row">
      {items.map(([k, v]) => (
        <div className="spec" key={k}>
          <div className="k">{k}</div>
          <div className="v" title={v}>{v}</div>
        </div>
      ))}
    </div>
  );
}

export function RecapLine({ icon, k, v }: { icon: ReactNode; k: ReactNode; v: ReactNode }) {
  return (
    <div className="recap-line">
      {icon}
      <span className="k">{k}</span>
      <span className="v">{v}</span>
    </div>
  );
}

/** Contenu d'étape qui glisse à chaque changement d'étape. */
export function StepPanel({ step, children }: { step: string; children: ReactNode }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={step}
        initial={{ opacity: 0, x: 24 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -24 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
