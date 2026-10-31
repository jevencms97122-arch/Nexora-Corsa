import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, CheckCircle2, ChevronDown, Download, ExternalLink, FolderOpen, Link2, PackageCheck, SlidersHorizontal, Sparkles, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage, type CspStatus, type ModInfo, type RecentDownload } from "../api";
import { usePersisted, type Notify } from "../hooks";
import Button from "../ui/Button";

interface Props {
  /** "banner" : invitation sur l'accueil (masquable). "panel" : état et mise à jour dans les paramètres. */
  variant: "banner" | "panel";
  notify: Notify;
}

const POLL_MS = 3500;

/** Installation à partir d'un fichier ou d'un lien choisi par l'utilisateur : n'importe quelle version de Custom Shaders Patch. */
function CustomInstall({ installed, notify, onInstalled, onBrowserOpened }: { installed: boolean; notify: Notify; onInstalled: () => void; onBrowserOpened: () => void }) {
  const [url, setUrl] = useState("");
  const [source, setSource] = useState<{ path: string; name: string } | null>(null);
  const [error, setError] = useState("");
  const [phase, setPhase] = useState<"idle" | "downloading" | "checking" | "installing">("idle");

  async function prepare(path: string) {
    setPhase("checking");
    setError("");
    try {
      const infos = await api.inspectMod(path);
      if (!infos.some((i) => i.kind === "csp")) {
        setSource(null);
        setError("Cette archive ne contient pas Custom Shaders Patch (il faut le fichier dwrite.dll et un dossier extension).");
      } else {
        setSource({ path, name: path.split(/[\\/]/).pop() ?? path });
      }
    } catch (e) {
      setSource(null);
      setError(errorMessage(e));
    } finally {
      setPhase("idle");
    }
  }

  async function browse() {
    const file = await open({ multiple: false, filters: [{ name: "Archive Custom Shaders Patch", extensions: ["zip", "7z", "rar"] }] });
    if (typeof file === "string") await prepare(file);
  }

  async function fromLink() {
    setPhase("downloading");
    setError("");
    setSource(null);
    try {
      await prepare(await api.downloadCsp(url.trim()));
    } catch (e) {
      setError(errorMessage(e));
      setPhase("idle");
    }
  }

  async function install() {
    if (!source) return;
    setPhase("installing");
    try {
      await api.installMod(source.path, installed);
      notify("Custom Shaders Patch installé.");
      setSource(null);
      setUrl("");
      onInstalled();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPhase("idle");
    }
  }

  const busy = phase !== "idle";
  return (
    <motion.div className="csp-custom stack" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
      <div className="csp-custom-block">
        <b>Depuis un fichier</b>
        <span className="muted small">Choisis l'archive (.zip, .7z ou .rar) de la version que tu veux, déjà téléchargée sur ton PC.</span>
        <Button icon={<FolderOpen size={16} />} disabled={busy} onClick={browse} style={{ alignSelf: "flex-start" }}>
          Choisir un fichier…
        </Button>
      </div>
      <div className="csp-custom-block">
        <b>Depuis un lien</b>
        <span className="muted small">Colle l'adresse (https) d'un téléchargement direct. Si c'est une page web, ouvre-la dans le navigateur : l'archive sera repérée dans Téléchargements.</span>
        <div className="row">
          <input className="input" placeholder="https://…" value={url} disabled={busy} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && url.trim() && fromLink()} />
          <Button icon={<Link2 size={16} />} disabled={!url.trim() || busy} loading={phase === "downloading"} onClick={fromLink}>
            Télécharger
          </Button>
          <Button
            variant="ghost"
            icon={<ExternalLink size={16} />}
            disabled={!url.trim() || busy}
            onClick={() => openUrl(url.trim()).then(onBrowserOpened).catch((e) => setError(errorMessage(e)))}
          >
            Ouvrir
          </Button>
        </div>
      </div>
      {(phase === "downloading" || phase === "checking" || phase === "installing") && <div className="progress-indeterminate" />}
      {error && (
        <div className="notice danger" style={{ marginTop: 0 }}>
          <AlertTriangle size={16} /> {error}
        </div>
      )}
      {source && (
        <>
          <div className="notice ok" style={{ marginTop: 0 }}>
            <CheckCircle2 size={16} />
            <span>
              <b>{source.name}</b> est bien une archive Custom Shaders Patch.
            </span>
          </div>
          <div className="notice warn" style={{ marginTop: 0 }}>
            <AlertTriangle size={16} />
            <span>
              L'installation copie <code>dwrite.dll</code> dans le dossier du jeu, chargé à chaque lancement. N'installe qu'un fichier dont tu connais la source.
              {installed && " L'ancien chargeur est conservé sous « dwrite.dll.nexora-bak »."}
            </span>
          </div>
          <Button variant="primary" shine loading={phase === "installing"} icon={<Download size={16} />} onClick={install} style={{ alignSelf: "flex-start" }}>
            {installed ? "Remplacer par cette version" : "Installer cette version"}
          </Button>
        </>
      )}
    </motion.div>
  );
}

/**
 * Custom Shaders Patch n'est pas redistribué par Nexora-Corsa : on guide vers sa page de téléchargement,
 * on repère l'archive dans Téléchargements et on propose de l'installer.
 */
export default function CspCard({ variant, notify }: Props) {
  const [status, setStatus] = useState<CspStatus | null>(null);
  const [offered, setOffered] = useState("");
  const [prefs, setPrefs] = usePersisted("nexora.csp", { dismissed: false });
  const [watching, setWatching] = useState(false);
  const [found, setFound] = useState<RecentDownload | null>(null);
  const [busy, setBusy] = useState(false);
  const [justInstalled, setJustInstalled] = useState(false);
  const [custom, setCustom] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  // Archives déjà examinées : on ne ré-ouvre pas une archive de plusieurs centaines de Mo à chaque passage.
  const checked = useRef(new Map<string, ModInfo[] | null>());

  const refresh = useCallback(() => api.cspStatus().then(setStatus).catch(() => {}), []);
  useEffect(() => {
    refresh();
    api.cspSource().then((s) => setOffered(s.version)).catch(() => {});
  }, [refresh]);

  const scan = useCallback(async () => {
    const downloads = await api.recentDownloads().catch(() => [] as RecentDownload[]);
    for (const d of downloads) {
      const key = `${d.path}|${d.size_mb}`;
      if (!checked.current.has(key)) {
        checked.current.set(key, await api.inspectMod(d.path).catch(() => null));
      }
      if (checked.current.get(key)?.some((i) => i.kind === "csp")) {
        setFound(d);
        setWatching(false);
        return;
      }
    }
  }, []);

  // Un seul passage au départ (le fichier est peut-être déjà téléchargé), puis une surveillance après le clic.
  useEffect(() => {
    scan();
  }, [scan]);
  useEffect(() => {
    if (!watching) return;
    const timer = setInterval(scan, POLL_MS);
    return () => clearInterval(timer);
  }, [watching, scan]);

  async function download() {
    try {
      await openUrl((await api.cspSource()).url);
      setWatching(true);
    } catch (e) {
      notify(errorMessage(e), "error");
    }
  }

  async function install() {
    if (!found) return;
    setBusy(true);
    try {
      await api.installMod(found.path, status?.installed ?? false);
      notify("Custom Shaders Patch installé.");
      setFound(null);
      setJustInstalled(true);
      await refresh();
    } catch (e) {
      notify(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function uninstall() {
    setBusy(true);
    try {
      setStatus(await api.uninstallCsp());
      setConfirmRemove(false);
      setJustInstalled(false);
      setCustom(false);
      setFound(null);
      notify("Custom Shaders Patch désinstallé.");
    } catch (e) {
      notify(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  if (!status) return null;
  const installed = status.installed;
  if (variant === "banner" && ((installed && !justInstalled) || (prefs.dismissed && !found && !watching))) return null;

  const version = status.version ? `v${status.version}` : "";

  return (
    <AnimatePresence>
      <motion.section
        className={`csp-card ${variant}`}
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      >
        <span className={`csp-icon ${installed ? "ok" : ""}`}>{installed ? <PackageCheck size={22} /> : <Sparkles size={22} />}</span>
        <div className="grow stack tight">
          <div className="csp-title">
            {installed ? (
              <>Custom Shaders Patch {version && <span className="tag ok">{version}</span>}</>
            ) : (
              "Installe Custom Shaders Patch"
            )}
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            {installed
              ? justInstalled
                ? "Installé avec succès. Il sera actif au prochain lancement du jeu."
                : "Graphismes, météo dynamique et prise en charge de nombreux mods : installé et prêt."
              : `Améliore les graphismes et la météo, et beaucoup de mods en ont besoin pour fonctionner. Nexora-Corsa te propose la version ${offered || "0.2.11"}.`}
          </p>

          {!installed && watching && !found && (
            <div className="stack tight">
              <div className="progress-indeterminate" />
              <span className="muted tiny">
                En attente du fichier… Télécharge-le sur la page qui vient de s'ouvrir (modland.net) : Nexora-Corsa le repère dans ton dossier Téléchargements.
              </span>
            </div>
          )}

          {!installed && found && (
            <>
              <div className="notice ok" style={{ marginTop: 6 }}>
                <CheckCircle2 size={16} />
                <span>
                  <b>{found.name}</b> est téléchargé ({found.size_mb} Mo).
                </span>
              </div>
              <div className="notice warn" style={{ marginTop: 0 }}>
                <AlertTriangle size={16} />
                <span>
                  L'installation copie <code>dwrite.dll</code> dans le dossier du jeu, chargé à chaque lancement d'Assetto Corsa. Installe uniquement
                  un fichier que tu as téléchargé toi-même depuis le lien proposé par Nexora-Corsa.
                  {installed && " L'ancien chargeur est conservé sous « dwrite.dll.nexora-bak »."}
                </span>
              </div>
            </>
          )}

          <div className="row wrap" style={{ marginTop: 6 }}>
            {installed ? (
              !confirmRemove && (
                <Button variant="danger" icon={<Trash2 size={16} />} onClick={() => setConfirmRemove(true)}>
                  Désinstaller Custom Shaders Patch
                </Button>
              )
            ) : found ? (
              <Button variant="primary" shine loading={busy} icon={<Download size={16} />} onClick={install}>
                Installer Custom Shaders Patch
              </Button>
            ) : (
              <Button variant="primary" shine={!watching} icon={<ExternalLink size={16} />} onClick={download}>
                {watching ? "Rouvrir la page de téléchargement" : `Télécharger la v${offered || "0.2.11"}`}
              </Button>
            )}
            <Button variant="ghost" icon={<SlidersHorizontal size={15} />} onClick={() => setCustom((v) => !v)}>
              Installation personnalisée
              <ChevronDown size={14} style={{ transform: custom ? "rotate(180deg)" : undefined, transition: "transform 0.2s" }} />
            </Button>
            {variant === "banner" && !installed && (
              <Button variant="ghost" onClick={() => setPrefs({ dismissed: true })}>
                Plus tard
              </Button>
            )}
          </div>
          {installed && confirmRemove && (
            <div className="notice warn" style={{ marginTop: 6 }}>
              <AlertTriangle size={16} />
              <span>
                Retire <code>dwrite.dll</code> et les fichiers du patch dans <code>extension</code>. Tes réglages (Documents/Assetto Corsa/cfg/extension), tes mods de
                ciel et tes fichiers personnels sont conservés. Ferme Assetto Corsa avant de continuer.
                <span className="row" style={{ marginTop: 8 }}>
                  <Button size="sm" variant="danger" loading={busy} icon={<Trash2 size={14} />} onClick={uninstall}>
                    Oui, désinstaller
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmRemove(false)}>
                    Annuler
                  </Button>
                </span>
              </span>
            </div>
          )}
          <AnimatePresence initial={false}>
            {custom && (
              <CustomInstall
                installed={installed}
                notify={notify}
                onBrowserOpened={() => setWatching(true)}
                onInstalled={() => {
                  setJustInstalled(true);
                  setCustom(false);
                  refresh();
                }}
              />
            )}
          </AnimatePresence>
        </div>
        {variant === "banner" && !installed && (
          <button className="icon-btn" title="Masquer" onClick={() => setPrefs({ dismissed: true })}>
            <X size={16} />
          </button>
        )}
      </motion.section>
    </AnimatePresence>
  );
}
