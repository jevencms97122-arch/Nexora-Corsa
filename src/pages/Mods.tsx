import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage, type InstalledMod, type ModInfo } from "../api";
import { useContent } from "../hooks";

interface Props {
  notify: (msg: string, kind?: "ok" | "error") => void;
  onContentChanged: () => void;
}

const KIND_LABEL = { car: "Voiture", track: "Circuit" } as const;

export default function Mods({ notify, onContentChanged }: Props) {
  const { cars, tracks } = useContent();
  const [pending, setPending] = useState<{ path: string; infos: ModInfo[] } | null>(null);
  const [installed, setInstalled] = useState<InstalledMod[]>([]);
  const [busy, setBusy] = useState(false);
  const [hover, setHover] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api.listMods().then(setInstalled).catch(() => {});
  }, []);
  useEffect(refresh, [refresh]);

  const inspect = useCallback(
    async (path: string) => {
      if (!path.toLowerCase().endsWith(".zip")) {
        notify("Seules les archives .zip sont prises en charge.", "error");
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

  // Glisser-déposer d'un zip sur la fenêtre.
  useEffect(() => {
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
  }, [inspect]);

  async function browse() {
    const file = await open({ multiple: false, filters: [{ name: "Archive de mod", extensions: ["zip"] }] });
    if (typeof file === "string") await inspect(file);
  }

  async function install() {
    if (!pending) return;
    setBusy(true);
    try {
      const done = await api.installMod(pending.path, pending.infos.some((i) => i.exists));
      notify(`Installé : ${done.map((d) => d.id).join(", ")}`);
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
      notify(`${m.id} désinstallé.`);
      setConfirmRemove(null);
      refresh();
      onContentChanged();
    } catch (e) {
      notify(errorMessage(e), "error");
    }
  }

  const nameOf = (m: InstalledMod) =>
    (m.kind === "car" ? cars.find((c) => c.id === m.id)?.name : tracks.find((t) => t.id === m.id)?.name) ?? m.id;
  const replacing = pending?.infos.filter((i) => i.exists) ?? [];

  return (
    <div className="page">
      <h1>Mods</h1>
      <section className={`card dropzone ${hover ? "hover" : ""}`}>
        <p>Glisse ici l'archive <b>.zip</b> d'une voiture ou d'un circuit</p>
        <button className="btn" disabled={busy} onClick={browse}>
          📁 Choisir un fichier…
        </button>
      </section>

      {pending && (
        <section className="card">
          <h2>À installer</h2>
          <p className="muted small">{pending.path}</p>
          {pending.infos.map((i) => (
            <p key={`${i.kind}-${i.id}`}>
              <b>{KIND_LABEL[i.kind]}</b> : {i.id} {i.exists && <span className="error">— déjà présent</span>}
            </p>
          ))}
          {replacing.length > 0 && (
            <p className="error small">
              Les fichiers de l'archive seront copiés par-dessus le contenu existant
              {replacing.some((i) => !i.managed) && " (contenu d'origine ou installé par un autre outil : il ne pourra pas être désinstallé d'ici)"}.
            </p>
          )}
          <div className="row">
            <button className="btn primary" disabled={busy} onClick={install}>
              {busy ? "Installation…" : replacing.length > 0 ? "Remplacer et installer" : "Installer"}
            </button>
            <button className="btn" disabled={busy} onClick={() => setPending(null)}>
              Annuler
            </button>
          </div>
        </section>
      )}

      <section className="card">
        <h2>Installés avec Nexora-Corsa</h2>
        {installed.length === 0 && <p className="muted">Aucun mod installé pour l'instant.</p>}
        {installed.map((m) => {
          const key = `${m.kind}-${m.id}`;
          return (
            <div className="chosen-row" key={key}>
              <span className="grow">
                <b>{KIND_LABEL[m.kind]}</b> · {nameOf(m)}
              </span>
              {confirmRemove === key ? (
                <>
                  <button className="btn danger small-btn" onClick={() => remove(m)}>
                    Confirmer la suppression
                  </button>
                  <button className="btn small-btn" onClick={() => setConfirmRemove(null)}>
                    Annuler
                  </button>
                </>
              ) : (
                <button className="btn small-btn" onClick={() => setConfirmRemove(key)}>
                  Désinstaller
                </button>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}
