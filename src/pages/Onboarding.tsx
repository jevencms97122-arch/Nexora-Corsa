import { open } from "@tauri-apps/plugin-dialog";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, CheckCircle2, FolderOpen, Gamepad2, User } from "lucide-react";
import { useEffect, useState } from "react";
import { api, errorMessage, type AppConfig } from "../api";
import Button from "../ui/Button";
import { Field } from "../ui/Fields";
import Logo from "../ui/Logo";

interface Props {
  config: AppConfig;
  onDone: (c: AppConfig) => void;
}

/** Premier lancement : trouver le jeu, puis choisir son pseudo. */
export default function Onboarding({ config, onDone }: Props) {
  const [step, setStep] = useState<0 | 1>(0);
  const [found, setFound] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const [cfg, setCfg] = useState(config);
  const [name, setName] = useState(config.player_name);

  useEffect(() => {
    // Petite pause pour laisser voir l'animation de recherche.
    const started = Date.now();
    api
      .detectGame()
      .catch(() => [] as string[])
      .then((list) => setTimeout(() => setFound(list), Math.max(0, 900 - (Date.now() - started))));
  }, []);

  async function choose(path: string) {
    try {
      setCfg(await api.setAcPath(path));
      setError("");
      setStep(1);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function browse() {
    const dir = await open({ directory: true, title: "Dossier d'installation d'Assetto Corsa" });
    if (typeof dir === "string") await choose(dir);
  }

  async function finish() {
    onDone(await api.setPlayerName(name.trim() || "Pilote"));
  }

  return (
    <div className="onboard">
      <motion.div
        className="onboard-card"
        initial={{ opacity: 0, y: 30, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      >
        <motion.div
          className="onboard-logo"
          initial={{ rotate: -20, scale: 0.6, opacity: 0 }}
          animate={{ rotate: 0, scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 220, damping: 14, delay: 0.15 }}
        >
          <Logo size={34} />
        </motion.div>
        <h1>
          Bienvenue sur <span>Nexora-Corsa</span>
        </h1>
        <p className="muted" style={{ margin: "10px 0 0" }}>
          Le launcher plug and play pour Assetto Corsa. Deux étapes et tu es en piste.
        </p>
        <div className="steps-dots">
          <span className="on" />
          <span className={step >= 1 ? "on" : ""} />
        </div>

        <AnimatePresence mode="wait">
          {step === 0 ? (
            <motion.div key="game" className="stack" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <div className="row" style={{ fontWeight: 700 }}>
                <Gamepad2 size={18} color="var(--accent-2)" /> Où est installé le jeu ?
              </div>
              {found === null && (
                <div className="scan">
                  <span className="radar" /> Recherche d'Assetto Corsa dans tes bibliothèques Steam…
                </div>
              )}
              {found?.map((p, i) => (
                <motion.button
                  key={p}
                  className="found-game"
                  onClick={() => choose(p)}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.08 }}
                >
                  <span className="fg-icon">
                    <CheckCircle2 size={20} />
                  </span>
                  <span className="grow">
                    <div style={{ fontWeight: 700 }}>Assetto Corsa trouvé</div>
                    <div className="muted small mono ellipsis">{p}</div>
                  </span>
                  <ArrowRight size={18} />
                </motion.button>
              ))}
              {found?.length === 0 && <div className="notice warn">Installation Steam introuvable automatiquement. Indique le dossier du jeu.</div>}
              <Button variant={found?.length === 0 ? "primary" : "ghost"} icon={<FolderOpen size={16} />} onClick={browse}>
                Choisir le dossier manuellement
              </Button>
              {error && <div className="notice danger">{error}</div>}
            </motion.div>
          ) : (
            <motion.div key="name" className="stack" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <div className="notice ok" style={{ marginTop: 0 }}>
                <CheckCircle2 size={16} /> Jeu trouvé : <span className="mono ellipsis">{cfg.ac_path}</span>
              </div>
              <Field label="Ton nom de pilote">
                <div className="input-icon">
                  <User size={17} />
                  <input
                    className="input big"
                    autoFocus
                    placeholder="Pilote"
                    value={name}
                    maxLength={32}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && finish()}
                  />
                </div>
              </Field>
              <Button variant="primary" size="lg" shine block icon={<ArrowRight size={18} />} onClick={finish}>
                C'est parti
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
