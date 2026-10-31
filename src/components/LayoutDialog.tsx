import { AnimatePresence, motion } from "motion/react";
import { Check, Flag, Globe, Ruler, X } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { Track, TrackLayout } from "../api";
import { formatLength, trackOutline, trackPreview } from "../assets";
import { useContent } from "../hooks";
import Img from "../ui/Img";

interface Props {
  /** Circuit dont on choisit la configuration ; `null` = fenêtre fermée. */
  track: Track | null;
  /** Configuration actuellement retenue (surlignée si elle appartient à ce circuit). */
  currentTrack: string;
  currentLayout: string;
  onPick: (track: Track, layout: TrackLayout) => void;
  onClose: () => void;
}

/** Fenêtre qui présente toutes les configurations d'un circuit, avec aperçu, tracé et caractéristiques. */
export default function LayoutDialog({ track, currentTrack, currentLayout, onPick, onClose }: Props) {
  const { acPath } = useContent();

  useEffect(() => {
    if (!track) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [track, onClose]);

  // Rendue dans <body> : les pages ont des transformations d'animation qui casseraient un `position: fixed`.
  return createPortal(
    <AnimatePresence>
      {track && (
        <motion.div
          className="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={`Configurations de ${track.name}`}
            initial={{ opacity: 0, y: 28, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
          >
            <header className="modal-head">
              <div>
                <div className="eyebrow">
                  <Flag size={13} /> Choisis la configuration
                </div>
                <h2>{track.name}</h2>
                <p className="muted small" style={{ margin: "4px 0 0" }}>
                  {[track.layouts[0].country, `${track.layouts.length} configurations`].filter(Boolean).join(" · ")}
                </p>
              </div>
              <button className="icon-btn" title="Fermer (Échap)" onClick={onClose}>
                <X size={18} />
              </button>
            </header>

            <div className="layout-grid">
              {track.layouts.map((l, i) => {
                const active = track.id === currentTrack && l.id === currentLayout;
                return (
                  <motion.button
                    key={l.id || "default"}
                    className={`layout-card ${active ? "selected" : ""}`}
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.05 + Math.min(i, 10) * 0.035, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                    onClick={() => onPick(track, l)}
                  >
                    <div className="layout-visual">
                      <Img srcs={trackPreview(acPath, track.id, l.id)} />
                      <div className="layout-outline">
                        <Img srcs={trackOutline(acPath, track.id, l.id)} contain quietFallback />
                      </div>
                      {active && (
                        <span className="check">
                          <Check size={15} strokeWidth={3} />
                        </span>
                      )}
                    </div>
                    <div className="layout-info">
                      <span className="layout-name" title={l.name}>{l.label || l.name}</span>
                      <span className="layout-meta">
                        {l.length && (
                          <span className="tag">
                            <Ruler size={11} /> {formatLength(l.length)}
                          </span>
                        )}
                        {l.pitboxes && (
                          <span className="tag">
                            <Globe size={11} /> {l.pitboxes} stands
                          </span>
                        )}
                        {active && <span className="tag accent">Sélectionnée</span>}
                      </span>
                    </div>
                  </motion.button>
                );
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
