import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Download, FolderOpen, Package, PackagePlus, Trash2, UploadCloud } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage, type InstalledMod, type ModInfo, type RecentDownload } from "../api";
import { carPreview, trackPreview } from "../assets";
import { useContent, type Notify } from "../hooks";
import { KIND_LABEL, KIND_TONE, KindIcon, kindName, kindNote, replaceNote } from "../components/KindIcon";
import Button from "../ui/Button";
import Img from "../ui/Img";
import { Item, Stagger } from "../ui/motion";
import PageHeader, { CardTitle } from "../ui/PageHeader";

interface Props {
  active: boolean;
  notify: Notify;
  onContentChanged: () => void;
}


export default function Mods({ active, notify, onContentChanged }: Props) {
  const { acPath, cars, tracks } = useContent();
  const [pending, setPending] = useState<{ path: string; infos: ModInfo[] } | null>(null);
  const [installed, setInstalled] = useState<InstalledMod[]>([]);
  const [recent, setRecent] = useState<RecentDownload[]>([]);
  const [busy, setBusy] = useState(false);
  const [hover, setHover] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api.listMods().then(setInstalled).catch(() => {});
    api.recentDownloads().then(setRecent).catch(() => {});
  }, []);
  useEffect(() => {
    if (active) refresh();
  }, [active, refresh]);

  const inspect = useCallback(
    async (path: string) => {
      if (!/\.(zip|7z|rar|ini)$/i.test(path)) {
        notify("Formats pris en charge : .zip, .7z, .rar et .ini (filtre d'image).", "error");
        return;
      }
      setBusy(true);
      try {
        setPending({ path, infos: await api.inspectMod(path) });
      } catch (e) {
        setPending(null);
        notify(errorMessage(e), "error");
      } finally {
        setBusy(false);
      }
    },
    [notify],
  );

  // Glisser-déposer d'une archive sur la fenêtre (uniquement quand cette page est affichée).
  useEffect(() => {
    if (!active) return;
    const un = getCurrentWebview().onDragDropEvent((e) => {
      const p = e.payload;
      if (p.type === "over" || p.type === "enter") setHover(true);
      else if (p.type === "leave") setHover(false);
      else if (p.type === "drop") {
        setHover(false);
        if (p.paths[0]) inspect(p.paths[0]);
      }
    });
    return () => {
      un.then((f) => f());
    };
  }, [active, inspect]);

  async function browse() {
    const file = await open({ multiple: false, filters: [{ name: "Archive de mod ou filtre d'image", extensions: ["zip", "7z", "rar", "ini"] }] });
    if (typeof file === "string") await inspect(file);
  }

  async function install() {
    if (!pending) return;
    setBusy(true);
    try {
      const done = await api.installMod(pending.path, pending.infos.some((i) => i.exists));
      const backup = done.find((d) => d.backup)?.backup;
      notify(`Installé : ${done.map((d) => kindName(d.kind, d.id)).join(", ")}.${backup ? ` Anciens fichiers sauvegardés dans ${backup}` : ""}`);
      setPending(null);
      refresh();
      onContentChanged();
    } catch (e) {
      notify(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function remove(m: InstalledMod) {
    try {
      await api.uninstallMod(m.kind, m.id);
      notify(`${nameOf(m)} désinstallé.`);
      setConfirmRemove(null);
      refresh();
      onContentChanged();
    } catch (e) {
      notify(errorMessage(e), "error");
    }
  }

  const nameOf = (m: { kind: string; id: string }) =>
    (m.kind === "car" ? cars.find((c) => c.id === m.id)?.name : tracks.find((t) => t.id === m.id)?.name) ?? m.id;
  const imageOf = (m: { kind: string; id: string }) => {
    if (m.kind === "car") {
      const car = cars.find((c) => c.id === m.id);
      return car ? carPreview(acPath, car.id, car.skins[0]) : [];
    }
    const track = tracks.find((t) => t.id === m.id);
    return track ? trackPreview(acPath, track.id, track.layouts[0].id) : [];
  };
  const replacing = pending?.infos.filter((i) => i.exists) ?? [];

  return (
    <div className="page">
      <PageHeader
        eyebrow={<><Package size={13} /> Contenu</>}
        title="Mods"
        subtitle="Installe des voitures et des circuits en un glisser-déposer."
      />

      <motion.section
        className={`dropzone ${hover ? "hover" : ""}`}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45 }}
      >
        <div className="drop-icon">
          <UploadCloud size={30} />
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 17 }}>{hover ? "Lâche pour analyser le fichier" : "Glisse une archive de mod ici"}</div>
          <div className="muted small" style={{ marginTop: 4 }}>
            Voitures, circuits, filtres d'image et mods de ciel, détectés automatiquement
          </div>
        </div>
        <div className="formats">
          <span className="tag">.zip</span>
          <span className="tag">.7z</span>
          <span className="tag">.rar</span>
          <span className="tag">.ini (filtre)</span>
        </div>
        <Button icon={<FolderOpen size={16} />} loading={busy && !pending} onClick={browse}>
          Choisir un fichier…
        </Button>
      </motion.section>

      <AnimatePresence>
        {pending && (
          <motion.section
            className="card"
            style={{ marginTop: 18, borderColor: "rgba(255, 120, 60, 0.45)" }}
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          >
            <CardTitle icon={<PackagePlus size={16} />}>Prêt à installer</CardTitle>
            <p className="muted small mono ellipsis" style={{ marginTop: -6 }}>{pending.path}</p>
            <div className="stack tight" style={{ margin: "12px 0" }}>
              {pending.infos.map((i) => (
                <div key={`${i.kind}-${i.id}`} className="row">
                  <span className={`kind-dot ${KIND_TONE[i.kind]}`}>
                    <KindIcon kind={i.kind} size={16} />
                  </span>
                  <span className="grow">
                    <b>{kindName(i.kind, i.id)}</b> <span className="muted small">· {KIND_LABEL[i.kind]}</span>
                  </span>
                  {i.exists && <span className="tag">Déjà présent</span>}
                </div>
              ))}
            </div>
            {[...new Set(pending.infos.map((i) => kindNote(i.kind)).filter((n): n is string => !!n))].map((note) => (
              <div key={note} className={`notice ${note.includes("dwrite") ? "warn" : "info"}`}>
                <AlertTriangle size={16} /> {note}
              </div>
            ))}
            {replaceNote(pending.infos) && (
              <div className="notice warn">
                <AlertTriangle size={16} /> {replaceNote(pending.infos)}
              </div>
            )}
            {replacing.length > 0 && !replaceNote(pending.infos) && !pending.infos.some((i) => i.kind === "csp") && (
              <div className="notice warn">
                <AlertTriangle size={16} /> Les fichiers de l'archive seront copiés par-dessus le contenu existant
                {replacing.some((i) => !i.managed) && " (contenu d'origine ou installé par un autre outil : il ne pourra pas être désinstallé d'ici)"}.
              </div>
            )}
            <div className="row" style={{ marginTop: 14 }}>
              <Button variant="primary" loading={busy} icon={<Download size={16} />} onClick={install}>
                {replacing.length > 0 ? "Remplacer et installer" : "Installer dans Assetto Corsa"}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setPending(null)}>
                Annuler
              </Button>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      <div className="two-col" style={{ marginTop: 18 }}>
        <section className="card">
          <CardTitle icon={<Package size={16} />} right={<span className="tag">{installed.length}</span>}>
            Installés avec Nexora-Corsa
          </CardTitle>
          {installed.length === 0 ? (
            <div className="empty">
              <div className="empty-icon">
                <Package size={24} />
              </div>
              Aucun mod installé pour l'instant.
            </div>
          ) : (
            <Stagger className="list">
              {installed.map((m) => {
                const key = `${m.kind}-${m.id}`;
                return (
                  <Item key={key}>
                    <div className="list-row">
                      <div className="thumb">
                        <Img srcs={imageOf(m)} />
                      </div>
                      <div className="grow">
                        <div className="title ellipsis">{nameOf(m)}</div>
                        <div className="sub">{KIND_LABEL[m.kind]} · {m.id}</div>
                      </div>
                      <AnimatePresence mode="wait" initial={false}>
                        {confirmRemove === key ? (
                          <motion.div key="confirm" className="row" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
                            <Button size="sm" variant="danger" onClick={() => remove(m)}>
                              Supprimer
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(null)}>
                              Annuler
                            </Button>
                          </motion.div>
                        ) : (
                          <motion.button key="ask" className="icon-btn danger" title="Désinstaller" onClick={() => setConfirmRemove(key)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                            <Trash2 size={16} />
                          </motion.button>
                        )}
                      </AnimatePresence>
                    </div>
                  </Item>
                );
              })}
            </Stagger>
          )}
        </section>

        <section className="card">
          <CardTitle icon={<Download size={16} />}>Téléchargés récemment</CardTitle>
          {recent.length === 0 ? (
            <div className="empty">
              <div className="empty-icon">
                <Download size={24} />
              </div>
              Aucune archive téléchargée dans la dernière heure.
            </div>
          ) : (
            <Stagger className="list">
              {recent.map((d) => (
                <Item key={d.path}>
                  <div className="list-row">
                    <span className="kind-dot solo">
                      <Package size={16} />
                    </span>
                    <div className="grow">
                      <div className="title ellipsis">{d.name}</div>
                      <div className="sub">
                        {d.size_mb} Mo · il y a {d.age_min} min
                      </div>
                    </div>
                    <Button size="sm" disabled={busy} onClick={() => inspect(d.path)}>
                      Installer
                    </Button>
                  </div>
                </Item>
              ))}
            </Stagger>
          )}
        </section>
      </div>
    </div>
  );
}
