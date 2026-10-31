import { motion } from "motion/react";
import { RotateCcw, Search, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, errorMessage, type ControlChange, type CspModule, type CspSetting } from "../api";
import type { Notify } from "../hooks";
import Button from "../ui/Button";
import { Slider, Switch } from "../ui/Fields";
import CspCard from "./CspCard";

const clean = (n: number) => String(Number(n.toFixed(4)));

function formatNumber(s: CspSetting, raw: string): string {
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) return raw;
  if (s.percent) return `${Math.round(n * 100)} %`;
  return `${clean(n)}${s.unit ? (s.unit === "%" || s.unit === "°" ? s.unit : ` ${s.unit}`) : ""}`;
}

/** Tous les réglages de Custom Shaders Patch, module par module (comme dans Content Manager). */
export default function CspSettings({ notify }: { notify: Notify }) {
  const [modules, setModules] = useState<CspModule[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CspModule | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const pending = useRef<ControlChange[]>([]);
  const timer = useRef<number | undefined>(undefined);
  const openRef = useRef<string | null>(null);
  openRef.current = openId;

  useEffect(() => {
    api
      .cspModules()
      .then((m) => {
        setModules(m);
        setOpenId((id) => id ?? m.find((x) => x.id === "general")?.id ?? m[0]?.id ?? null);
      })
      .catch((e) => {
        setModules([]);
        notify(errorMessage(e), "error");
      });
    return () => window.clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!openId) return;
    setDetail(null);
    setFilter("");
    api.cspModule(openId).then(setDetail).catch((e) => notify(errorMessage(e), "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);

  /** Met à jour la liste (pastille « actif », nombre de modifications) à partir du module relu. */
  const sync = useCallback((m: CspModule) => {
    setModules((list) => list?.map((x) => (x.id === m.id ? { ...x, enabled: m.enabled, changed: m.changed } : x)) ?? list);
  }, []);

  const flush = useCallback(() => {
    const id = openRef.current;
    const batch = pending.current;
    pending.current = [];
    if (!id || batch.length === 0) return;
    api
      .setCspValues(id, batch)
      .then((m) => {
        if (openRef.current === id) setDetail(m);
        sync(m);
      })
      .catch((e) => {
        notify(errorMessage(e), "error");
        api.cspModule(id).then(setDetail).catch(() => {});
      });
  }, [notify, sync]);

  const change = useCallback(
    (s: CspSetting, value: string, delay = 0) => {
      setDetail((d) =>
        d
          ? {
              ...d,
              sections: d.sections.map((sec) => ({
                ...sec,
                settings: sec.settings.map((x) => (x.section === s.section && x.key === s.key ? { ...x, value, changed: value.trim() !== x.default.trim() } : x)),
              })),
            }
          : d,
      );
      pending.current = pending.current.filter((p) => !(p.section === s.section && p.key === s.key));
      pending.current.push({ section: s.section, key: s.key, value });
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, delay);
    },
    [flush],
  );

  async function reset() {
    if (!detail) return;
    window.clearTimeout(timer.current);
    pending.current = [];
    try {
      const m = await api.resetCspModule(detail.id);
      setDetail(m);
      sync(m);
      notify(`« ${m.name} » remis aux valeurs d'origine.`);
    } catch (e) {
      notify(errorMessage(e), "error");
    }
  }

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (modules ?? []).filter((m) => !q || m.name.toLowerCase().includes(q) || m.summary.toLowerCase().includes(q));
  }, [modules, search]);

  const matches = (s: CspSetting) => {
    const q = filter.trim().toLowerCase();
    return !q || s.label.toLowerCase().includes(q) || s.key.toLowerCase().includes(q);
  };

  if (modules === null) return <div className="skeleton" style={{ height: 360, borderRadius: 16 }} />;
  if (modules.length === 0) {
    return (
      <div className="stack">
        <div className="notice info" style={{ marginTop: 0 }}>
          Custom Shaders Patch n'est pas installé : ses réglages apparaîtront ici dès qu'il le sera.
        </div>
        <CspCard variant="panel" notify={notify} />
      </div>
    );
  }

  const control = (s: CspSetting) => {
    const num = Number.parseFloat(s.value);
    if (s.kind === "number" && s.min !== null && s.max !== null && Number.isFinite(num)) {
      return (
        <div className="csp-field">
          <span className="csp-label">
            {s.label}
            <b>{formatNumber(s, s.value)}</b>
          </span>
          <Slider value={Math.min(s.max, Math.max(s.min, num))} min={s.min} max={s.max} step={s.step ?? 0.01} onChange={(n) => change(s, clean(n), 350)} />
          {s.note && <small className="csp-note">{s.note}</small>}
        </div>
      );
    }
    switch (s.kind) {
      case "bool":
        return <Switch label={s.label} hint={s.note || undefined} checked={s.value.trim() === "1"} onChange={(on) => change(s, on ? "1" : "0")} />;
      case "choice": {
        const known = s.options.some(([v]) => v === s.value.trim());
        return (
          <div className="csp-field">
            <span className="csp-label">{s.label}</span>
            <select className="select" value={s.value.trim()} onChange={(e) => change(s, e.target.value)}>
              {!known && <option value={s.value}>{s.value}</option>}
              {s.options.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
            {s.note && <small className="csp-note">{s.note}</small>}
          </div>
        );
      }
      default:
        return (
          <div className="csp-field">
            <span className="csp-label">{s.label}</span>
            <input
              className="input"
              defaultValue={s.value}
              key={`${s.key}-${s.value}`}
              onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== s.value.trim() && change(s, e.target.value.trim())}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            />
            {s.note && <small className="csp-note">{s.note}</small>}
          </div>
        );
    }
  };

  return (
    <div className="csp-layout">
      <aside className="csp-list">
        <div className="csp-search">
          <Search size={15} />
          <input className="input" placeholder="Chercher un module…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="csp-items">
          {shown.map((m) => (
            <button key={m.id} className={`csp-item ${m.id === openId ? "active" : ""} ${m.enabled === false ? "off" : ""}`} onClick={() => setOpenId(m.id)}>
              <span className="csp-name">{m.name}</span>
              {m.changed > 0 && <span className="tag">{m.changed}</span>}
              {m.enabled && <span className="dev-dot on" title="Actif" />}
            </button>
          ))}
          {shown.length === 0 && <div className="muted small" style={{ padding: 12 }}>Aucun module ne correspond.</div>}
        </div>
      </aside>

      <section className="card stack csp-editor">
        {!detail ? (
          <div className="skeleton" style={{ height: 280, borderRadius: 12 }} />
        ) : (
          <motion.div key={detail.id} className="stack" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}>
            <div className="row">
              <div className="grow">
                <h3 className="csp-title">{detail.name}</h3>
                {detail.description && <p className="muted small" style={{ margin: "4px 0 0" }}>{detail.description}</p>}
              </div>
              <Button size="sm" icon={<RotateCcw size={14} />} disabled={detail.changed === 0} onClick={reset}>
                Valeurs d'origine
              </Button>
            </div>
            <div className="csp-search">
              <Search size={15} />
              <input className="input" placeholder="Filtrer les réglages de ce module…" value={filter} onChange={(e) => setFilter(e.target.value)} />
            </div>
            {detail.sections.map((sec) => {
              const rows = sec.settings.filter(matches);
              if (rows.length === 0) return null;
              return (
                <div key={sec.id} className="csp-section">
                  <div className="csp-section-title">{sec.title}</div>
                  {rows.map((s) => (
                    <div key={`${s.section}-${s.key}`} className={`csp-row ${s.changed ? "changed" : ""}`}>
                      <div className="grow">{control(s)}</div>
                      {s.changed ? (
                        <button className="icon-btn" title={`Remettre à ${s.kind === "number" ? formatNumber(s, s.default) : s.default}`} onClick={() => change(s, s.default)}>
                          <Undo2 size={15} />
                        </button>
                      ) : (
                        <span style={{ width: 32 }} />
                      )}
                    </div>
                  ))}
                </div>
              );
            })}
            <p className="muted tiny" style={{ margin: 0 }}>
              Les réglages sont écrits dans Documents/Assetto Corsa/cfg/extension, jamais dans les fichiers du patch. Ils sont pris en compte au prochain lancement du jeu.
            </p>
          </motion.div>
        )}
      </section>
    </div>
  );
}
