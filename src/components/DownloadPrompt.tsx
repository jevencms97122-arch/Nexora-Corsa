import { listen } from "@tauri-apps/api/event";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, CheckCircle2, Download, FolderOpen, PackageCheck, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, errorMessage, type ModInfo } from "../api";
import Button from "../ui/Button";
import { KIND_LABEL, KindIcon, kindName, kindNote, replaceNote } from "./KindIcon";

type Phase = "downloading" | "checking" | "ready" | "installing" | "done" | "unsupported" | "failed";

interface Item {
  key: number;
  url: string;
  name: string;
  phase: Phase;
  path?: string;
  infos?: ModInfo[];
  message?: string;
}

interface Props {
  onContentChanged: () => void;
}

/** Suit les téléchargements du Garage et propose d'installer les mods dès qu'ils sont arrivés. */
export default function DownloadPrompt({ onContentChanged }: Props) {
  const [items, setItems] = useState<Item[]>([]);
  const itemsRef = useRef<Item[]>([]);
  itemsRef.current = items;
  const nextKey = useRef(1);

  const patch = (key: number, changes: Partial<Item>) =>
    setItems((list) => list.map((i) => (i.key === key ? { ...i, ...changes } : i)));
  const dismiss = (key: number) => setItems((list) => list.filter((i) => i.key !== key));

  async function analyse(key: number, path: string, name: string) {
    if (!/\.(zip|7z|rar|ini)$/i.test(path)) {
      patch(key, {
        phase: "unsupported",
        message: "Ce fichier n'est pas une archive .zip, .7z ou .rar (ni un filtre .ini) : il n'a pas été reconnu comme un mod.",
      });
      return;
    }
    patch(key, { phase: "checking", name });
    try {
      patch(key, { phase: "ready", infos: await api.inspectMod(path) });
    } catch (e) {
      patch(key, { phase: "unsupported", message: errorMessage(e) });
    }
  }

  useEffect(() => {
    const started = listen<{ url: string; name: string }>("download-started", (e) => {
      const key = nextKey.current++;
      setItems((list) => [...list, { key, url: e.payload.url, name: e.payload.name || "fichier", phase: "downloading" }]);
    });
    const finished = listen<{ url: string; name: string; path: string | null; success: boolean }>("download-finished", (e) => {
      const { url, name, path, success } = e.payload;
      // Le téléchargement concerné est le plus ancien encore en cours pour cette adresse.
      const item = itemsRef.current.find((i) => i.url === url && i.phase === "downloading");
      if (!item) return;
      if (success && path) {
        patch(item.key, { path, name: name || item.name });
        analyse(item.key, path, name || item.name);
      } else {
        patch(item.key, { phase: "failed", message: "Le téléchargement a échoué ou a été interrompu." });
      }
    });
    return () => {
      started.then((f) => f());
      finished.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function install(item: Item) {
    if (!item.path) return;
    patch(item.key, { phase: "installing" });
    try {
      const done = await api.installMod(item.path, item.infos?.some((i) => i.exists) ?? false);
      patch(item.key, { phase: "done", infos: done });
      onContentChanged();
      // Quand des fichiers ont été sauvegardés, la carte reste jusqu'à ce qu'on la ferme : l'emplacement est utile à lire.
      if (!done.some((d) => d.backup)) setTimeout(() => dismiss(item.key), 5000);
    } catch (e) {
      patch(item.key, { phase: "unsupported", message: errorMessage(e) });
    }
  }

  return (
    <div className="downloads">
      <AnimatePresence>
        {items.map((item) => {
          const replacing = item.infos?.filter((i) => i.exists) ?? [];
          const bad = item.phase === "unsupported" || item.phase === "failed";
          const tone = item.phase === "ready" ? "ready" : item.phase === "done" ? "done" : bad ? "bad" : "";
          return (
            <motion.div
              key={item.key}
              layout
              className={`download-card ${tone}`}
              initial={{ opacity: 0, x: 60, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 60, scale: 0.95 }}
              transition={{ type: "spring", stiffness: 320, damping: 30 }}
            >
              <div className="d-head">
                <span className="d-icon">
                  {item.phase === "done" ? <PackageCheck size={20} /> : bad ? <AlertTriangle size={20} /> : item.phase === "ready" ? <CheckCircle2 size={20} /> : <Download size={20} />}
                </span>
                <div className="grow">
                  <div className="d-title">
                    {item.phase === "downloading" && "Téléchargement en cours…"}
                    {item.phase === "checking" && "Analyse de l'archive…"}
                    {item.phase === "ready" && "Téléchargé, prêt à installer"}
                    {item.phase === "installing" && "Installation…"}
                    {item.phase === "done" && "Installé dans Assetto Corsa"}
                    {item.phase === "failed" && "Téléchargement échoué"}
                    {item.phase === "unsupported" && "Installation impossible"}
                  </div>
                  <div className="d-file ellipsis">{item.name}</div>
                </div>
                {(item.phase === "ready" || bad || item.phase === "done") && (
                  <button className="icon-btn" title="Fermer" onClick={() => dismiss(item.key)}>
                    <X size={15} />
                  </button>
                )}
              </div>

              {(item.phase === "downloading" || item.phase === "checking" || item.phase === "installing") && <div className="progress-indeterminate" />}

              {(item.phase === "ready" || item.phase === "done") &&
                item.infos?.map((i) => (
                  <div key={`${i.kind}-${i.id}`} className="row small">
                    <KindIcon kind={i.kind} color="var(--accent-2)" />
                    <span className="muted">{KIND_LABEL[i.kind]}</span>
                    <b className="ellipsis">{kindName(i.kind, i.id)}</b>
                  </div>
                ))}

              {item.phase === "ready" &&
                [...new Set(item.infos?.map((i) => kindNote(i.kind)).filter((n): n is string => !!n))].map((note) => (
                  <div key={note} className={`notice ${note.includes("dwrite") ? "warn" : "info"}`} style={{ marginTop: 0 }}>
                    <AlertTriangle size={15} /> {note}
                  </div>
                ))}
              {item.phase === "ready" && item.infos && replaceNote(item.infos) && (
                <div className="notice warn" style={{ marginTop: 0 }}>
                  <AlertTriangle size={15} /> {replaceNote(item.infos)}
                </div>
              )}
              {item.phase === "done" && item.infos?.some((i) => i.backup) && (
                <div className="notice info" style={{ marginTop: 0 }}>
                  <CheckCircle2 size={15} /> Anciens fichiers sauvegardés dans <code className="ellipsis">{item.infos.find((i) => i.backup)?.backup}</code>
                </div>
              )}
              {item.phase === "ready" && replacing.length > 0 && !(item.infos && replaceNote(item.infos)) && !item.infos?.some((i) => i.kind === "csp") && (
                <div className="notice warn" style={{ marginTop: 0 }}>
                  <AlertTriangle size={15} /> Déjà présent : les fichiers seront copiés par-dessus.
                </div>
              )}
              {item.phase === "ready" && (
                <div className="row">
                  <Button variant="primary" size="sm" shine onClick={() => install(item)}>
                    {replacing.length > 0 ? "Remplacer et installer" : "Installer dans Assetto Corsa"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => dismiss(item.key)}>
                    Plus tard
                  </Button>
                </div>
              )}
              {bad && (
                <>
                  <span className="small text-2">{item.message}</span>
                  {item.path && (
                    <Button size="sm" icon={<FolderOpen size={14} />} onClick={() => revealItemInDir(item.path!)} style={{ alignSelf: "flex-start" }}>
                      Afficher le fichier
                    </Button>
                  )}
                </>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
