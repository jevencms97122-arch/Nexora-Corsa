//! Réglages de Custom Shaders Patch.
//!
//! Chaque module du patch a un fichier `extension/config/<module>.ini` dans le dossier du jeu. Les lignes sont
//! auto-descriptives : `CLÉ=valeur ; Libellé ; 1 or 0` ou `; from 0 to 1, perc., round to 0.01` ou
//! `; 0 for Low, 1 for High`. On en déduit le type de chaque réglage. Les modifications ne vont jamais dans ces
//! fichiers : elles sont écrites dans `Documents/Assetto Corsa/cfg/extension/<module>.ini`, qui prend le dessus
//! (comme le fait Content Manager).

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

#[derive(Serialize, Debug, PartialEq, Clone)]
pub struct Setting {
    pub section: String,
    pub key: String,
    pub label: String,
    /// Précisions du fichier (« only with … », avertissements).
    pub note: String,
    /// `bool`, `number`, `choice` ou `text`.
    pub kind: &'static str,
    pub value: String,
    pub default: String,
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub step: Option<f64>,
    /// La valeur est une fraction affichée en pourcentage (0,5 → 50 %).
    pub percent: bool,
    pub unit: String,
    /// Pour `choice` : (valeur, libellé).
    pub options: Vec<(String, String)>,
    pub changed: bool,
}

#[derive(Serialize, Debug)]
pub struct Section {
    pub id: String,
    pub title: String,
    pub settings: Vec<Setting>,
}

#[derive(Serialize, Debug)]
pub struct Module {
    pub id: String,
    pub name: String,
    pub summary: String,
    pub description: String,
    /// État du réglage `[BASIC] ENABLED`, s'il existe.
    pub enabled: Option<bool>,
    pub settings: usize,
    pub changed: usize,
    pub sections: Vec<Section>,
}

#[derive(Deserialize, Debug)]
pub struct Change {
    section: String,
    key: String,
    value: String,
}

// ---------- lecture des spécifications ----------

enum Spec {
    Bool,
    Range { min: f64, max: f64, step: Option<f64>, percent: bool, unit: String },
    Choice(Vec<(String, String)>),
}

fn number_prefix(s: &str) -> Option<(f64, &str)> {
    let end = s.char_indices().find(|(i, c)| !(c.is_ascii_digit() || *c == '.' || (*c == '-' && *i == 0))).map_or(s.len(), |(i, _)| i);
    s[..end].parse::<f64>().ok().map(|n| (n, &s[end..]))
}

fn parse_range(part: &str) -> Option<Spec> {
    let rest = part.trim().strip_prefix("from ")?;
    let (min, after_min) = number_prefix(rest.trim_start())?;
    let to = after_min.find("to ")?;
    let unit = after_min[..to].trim().to_string();
    let (max, tail) = number_prefix(after_min[to + 3..].trim_start())?;
    let percent = tail.contains("perc");
    let step = tail.find("round").and_then(|i| {
        let t = tail[i..].trim_start_matches(|c: char| c.is_alphabetic() || c == ' ');
        number_prefix(t).map(|(n, _)| n)
    });
    Some(Spec::Range { min, max, step, percent, unit })
}

fn unquote(s: &str) -> String {
    s.trim().trim_matches('"').to_string()
}

/// `0 for Low, 1 for High` ou `Default is 0, "Force disable" is 1`.
fn parse_choice(part: &str) -> Option<Spec> {
    let mut options = vec![];
    let mut buf = String::new();
    let mut quoted = false;
    let mut pieces = vec![];
    for c in part.chars() {
        match c {
            '"' => {
                quoted = !quoted;
                buf.push(c);
            }
            ',' if !quoted => pieces.push(std::mem::take(&mut buf)),
            _ => buf.push(c),
        }
    }
    pieces.push(buf);
    for piece in pieces {
        let p = piece.trim();
        let is_int = |s: &str| s.parse::<i64>().is_ok();
        if let Some((value, label)) = p.split_once(" for ").filter(|(v, _)| is_int(v.trim())) {
            options.push((value.trim().to_string(), unquote(label)));
        } else if let Some((label, value)) = p.rsplit_once(" is ").filter(|(_, v)| is_int(v.trim())) {
            options.push((value.trim().to_string(), unquote(label)));
        } else {
            return None;
        }
    }
    (options.len() >= 2).then_some(Spec::Choice(options))
}

fn parse_spec(part: &str) -> Option<Spec> {
    let p = part.trim();
    if let Some((a, b)) = p.split_once(" or ") {
        if matches!((a.trim(), b.trim()), ("1", "0") | ("0", "1")) {
            return Some(Spec::Bool);
        }
    }
    parse_range(p).or_else(|| parse_choice(p))
}

/// Un réglage lu dans le fichier d'origine, avant fusion avec les modifications de l'utilisateur.
struct Raw {
    section: String,
    key: String,
    value: String,
    label: String,
    note: String,
    spec: Option<Spec>,
}

struct Parsed {
    name: String,
    summary: String,
    description: String,
    /// (identifiant, titre, réglages) dans l'ordre du fichier.
    sections: Vec<(String, String, Vec<Raw>)>,
}

fn prettify(name: &str) -> String {
    let lower = name.replace('_', " ").to_lowercase();
    let mut c = lower.chars();
    c.next().map_or(String::new(), |f| f.to_uppercase().collect::<String>() + c.as_str())
}

fn parse(text: &str, fallback_name: &str) -> Parsed {
    let mut parsed = Parsed { name: prettify(fallback_name), summary: String::new(), description: String::new(), sections: vec![] };
    let mut header: Option<Vec<(String, String)>> = None;
    let mut current: Option<(String, Option<String>, Vec<Raw>, Vec<(String, String)>)> = None; // id, titre, réglages, clés brutes
    let mut cur_first = false;
    let mut seen = 0;

    let finish = |cur: Option<(String, Option<String>, Vec<Raw>, Vec<(String, String)>)>, parsed: &mut Parsed, header: &mut Option<Vec<(String, String)>>, is_first: bool| {
        if let Some((id, title, raws, keys)) = cur {
            if is_first && keys.iter().any(|(k, _)| k == "FULLNAME") {
                *header = Some(keys);
            } else if title.as_deref() != Some("hidden") && !raws.is_empty() {
                parsed.sections.push((id.clone(), title.unwrap_or_else(|| prettify(&id)), raws));
            }
        }
    };

    for line in text.lines() {
        let t = line.trim();
        if let Some(name) = t.strip_prefix('[').and_then(|s| s.strip_suffix(']')) {
            finish(current.take(), &mut parsed, &mut header, cur_first);
            cur_first = seen == 0;
            seen += 1;
            current = Some((name.to_string(), None, vec![], vec![]));
            continue;
        }
        let Some((sec_id, title, raws, keys)) = current.as_mut() else { continue };
        if let Some(comment) = t.strip_prefix(';') {
            // Premier commentaire de la section = son titre (« ; Rendering options »).
            if title.is_none() && raws.is_empty() && !comment.trim_start().starts_with('[') && !comment.contains('=') {
                *title = Some(comment.trim().to_string());
            }
            continue;
        }
        let Some((k, v)) = t.split_once('=') else { continue };
        let key = k.trim().to_string();
        let mut parts = v.split(';');
        let value = parts.next().unwrap_or("").trim().to_string();
        let comment: Vec<String> = parts.map(|p| p.trim().to_string()).collect();
        keys.push((key.clone(), value.clone()));
        if comment.iter().any(|p| p.eq_ignore_ascii_case("hidden")) || raws.iter().any(|r: &Raw| r.key == key) {
            continue;
        }
        let spec_at = comment.iter().skip(1).position(|p| parse_spec(p).is_some()).map(|i| i + 1);
        let spec = spec_at.and_then(|i| parse_spec(&comment[i]));
        let label = comment.first().cloned().unwrap_or_default();
        let note = comment
            .iter()
            .enumerate()
            .skip(1)
            .filter(|(i, p)| Some(*i) != spec_at && !p.is_empty())
            .map(|(_, p)| p.as_str())
            .collect::<Vec<_>>()
            .join(" · ");
        raws.push(Raw { section: sec_id.clone(), key: key.clone(), value, label: if label.is_empty() { prettify(&key) } else { label }, note, spec });
    }
    finish(current.take(), &mut parsed, &mut header, cur_first);

    if let Some(h) = header {
        let get = |k: &str| h.iter().find(|(key, _)| key == k).map(|(_, v)| v.clone()).unwrap_or_default();
        if !get("FULLNAME").is_empty() {
            parsed.name = get("FULLNAME");
        }
        parsed.summary = get("SHORT_DESCRIPTION");
        parsed.description = get("DESCRIPTION");
    }
    parsed
}

fn same(a: &str, b: &str) -> bool {
    match (a.trim().parse::<f64>(), b.trim().parse::<f64>()) {
        (Ok(x), Ok(y)) => (x - y).abs() < 1e-9,
        _ => a.trim() == b.trim(),
    }
}

fn setting(raw: &Raw, overrides: &str) -> Setting {
    let value = crate::ini::get(overrides, &raw.section, &raw.key).unwrap_or_else(|| raw.value.clone());
    let mut s = Setting {
        section: raw.section.clone(),
        key: raw.key.clone(),
        label: raw.label.clone(),
        note: raw.note.clone(),
        kind: "text",
        changed: !same(&value, &raw.value),
        value,
        default: raw.value.clone(),
        min: None,
        max: None,
        step: None,
        percent: false,
        unit: String::new(),
        options: vec![],
    };
    match &raw.spec {
        Some(Spec::Bool) => s.kind = "bool",
        Some(Spec::Choice(options)) => {
            s.kind = "choice";
            s.options = options.clone();
        }
        Some(Spec::Range { min, max, step, percent, unit }) => {
            s.kind = "number";
            s.min = Some(*min);
            s.max = Some(*max);
            s.percent = *percent;
            s.unit = unit.clone();
            s.step = Some(step.unwrap_or(if max - min <= 1.0 { 0.01 } else if max - min <= 10.0 { 0.1 } else { 1.0 }));
        }
        None => {
            if raw.value.parse::<f64>().is_ok() {
                s.kind = "number";
            }
        }
    }
    s
}

fn build(id: &str, text: &str, overrides: &str) -> Module {
    let parsed = parse(text, id);
    let sections: Vec<Section> = parsed
        .sections
        .iter()
        .map(|(sid, title, raws)| Section { id: sid.clone(), title: title.clone(), settings: raws.iter().map(|r| setting(r, overrides)).collect() })
        .collect();
    let all = || sections.iter().flat_map(|s| &s.settings);
    let enabled = all().find(|s| s.section.eq_ignore_ascii_case("BASIC") && s.key == "ENABLED").map(|s| s.value.trim() != "0");
    Module {
        id: id.to_string(),
        name: parsed.name,
        summary: parsed.summary,
        description: parsed.description,
        enabled,
        settings: all().count(),
        changed: all().filter(|s| s.changed).count(),
        sections,
    }
}

// ---------- fichiers ----------

fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(crate::config::require_ac(app)?.join("extension").join("config"))
}

fn override_dir() -> Result<PathBuf, String> {
    Ok(crate::race::cfg_dir()?.join("extension"))
}

/// Identifiants des modules (fichiers hors `data_*`), dans l'ordre alphabétique.
fn module_ids(dir: &Path) -> Vec<String> {
    let mut ids: Vec<String> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| e.file_name().to_str().map(str::to_string))
        .filter_map(|n| n.strip_suffix(".ini").map(str::to_string))
        .filter(|id| !id.starts_with("data_"))
        .collect();
    ids.sort();
    ids
}

fn read_text(path: &Path) -> String {
    fs::read(path).map(|b| String::from_utf8_lossy(&b).into_owned()).unwrap_or_default()
}

fn load_module(config: &Path, overrides: &Path, id: &str) -> Result<Module, String> {
    if !module_ids(config).iter().any(|m| m == id) {
        return Err(format!("Module inconnu : {id}"));
    }
    Ok(build(id, &read_text(&config.join(format!("{id}.ini"))), &read_text(&overrides.join(format!("{id}.ini")))))
}

fn list_modules(config: &Path, overrides: &Path) -> Vec<Module> {
    let mut modules: Vec<Module> = module_ids(config)
        .iter()
        .map(|id| {
            let mut m = build(id, &read_text(&config.join(format!("{id}.ini"))), &read_text(&overrides.join(format!("{id}.ini"))));
            m.sections.clear(); // la liste n'a pas besoin du détail
            m
        })
        .filter(|m| m.settings > 0)
        .collect();
    modules.sort_by_key(|m| m.name.to_lowercase());
    modules
}

fn valid_value(v: &str) -> bool {
    !v.is_empty() && v.len() <= 200 && v.chars().all(|c| !c.is_control() && !matches!(c, ';' | '[' | ']' | '='))
}

fn write_values(config: &Path, overrides: &Path, id: &str, changes: &[Change]) -> Result<Module, String> {
    let module = load_module(config, overrides, id)?;
    let known = |c: &Change| module.sections.iter().flat_map(|s| &s.settings).any(|s| s.section.eq_ignore_ascii_case(&c.section) && s.key.eq_ignore_ascii_case(&c.key));
    for c in changes {
        if !known(c) {
            return Err(format!("Réglage inconnu : [{}] {}", c.section, c.key));
        }
        if !valid_value(&c.value) {
            return Err(format!("Valeur refusée pour {} : {:?}", c.key, c.value));
        }
    }
    let file = overrides.join(format!("{id}.ini"));
    let existing = read_text(&file);
    let updates: Vec<(&str, &str, String)> = changes.iter().map(|c| (c.section.as_str(), c.key.as_str(), c.value.clone())).collect();
    fs::create_dir_all(overrides).map_err(|e| format!("Dossier de réglages inaccessible : {e}"))?;
    fs::write(&file, crate::ini::set_values(&existing, &updates)).map_err(|e| format!("Écriture impossible : {e}"))?;
    load_module(config, overrides, id)
}

/// Remet chaque réglage modifié à la valeur d'origine du patch.
fn reset_module(config: &Path, overrides: &Path, id: &str) -> Result<Module, String> {
    let module = load_module(config, overrides, id)?;
    let changes: Vec<Change> = module
        .sections
        .iter()
        .flat_map(|s| &s.settings)
        .filter(|s| s.changed)
        .map(|s| Change { section: s.section.clone(), key: s.key.clone(), value: s.default.clone() })
        .collect();
    if changes.is_empty() {
        return Ok(module);
    }
    write_values(config, overrides, id, &changes)
}

#[tauri::command]
pub fn csp_modules(app: AppHandle) -> Result<Vec<Module>, String> {
    let config = config_dir(&app)?;
    Ok(list_modules(&config, &override_dir()?))
}

#[tauri::command]
pub fn csp_module(app: AppHandle, id: String) -> Result<Module, String> {
    load_module(&config_dir(&app)?, &override_dir()?, &id)
}

#[tauri::command]
pub fn set_csp_values(app: AppHandle, id: String, changes: Vec<Change>) -> Result<Module, String> {
    write_values(&config_dir(&app)?, &override_dir()?, &id, &changes)
}

#[tauri::command]
pub fn reset_csp_module(app: AppHandle, id: String) -> Result<Module, String> {
    reset_module(&config_dir(&app)?, &override_dir()?, &id)
}

#[cfg(test)]
mod tests {
    use super::*;

    const GRASS: &str = "[ℹ]\nFULLNAME=Grass FX\nDESCRIPTION=Adds grass.\nSHORT_DESCRIPTION=Grass everywhere\n\n[BASIC]\n; Extension\nENABLED=1 ; Active (set to 0 to disable Grass FX); 1 or 0\nQUALITY=2 ; Quality; 0 for Very low, 1 for Low, 2 for Medium, 3 for High, 4 for Very high\nDENSITY=0.5 ; Density; from 0 to 1, perc., round to 0.05\nSECRET=3 ; Not for users; hidden\n\n; [OLD]\n; OLD_KEY=1 ; Gone; 1 or 0\n\n[GENERATION_0]\n; hidden\nMAP_RESOLUTION = 512\n";

    fn find<'a>(m: &'a Module, key: &str) -> &'a Setting {
        m.sections.iter().flat_map(|s| &s.settings).find(|s| s.key == key).unwrap()
    }

    #[test]
    fn reads_module_header_and_visible_settings() {
        let m = build("grass_fx", GRASS, "");
        assert_eq!((m.name.as_str(), m.summary.as_str()), ("Grass FX", "Grass everywhere"));
        assert_eq!(m.sections.len(), 1, "sections cachées et commentées ignorées");
        assert_eq!(m.sections[0].title, "Extension");
        assert_eq!(m.settings, 3);
        assert_eq!(m.enabled, Some(true));
    }

    #[test]
    fn deduces_the_kind_of_each_setting() {
        let m = build("grass_fx", GRASS, "");
        assert_eq!(find(&m, "ENABLED").kind, "bool");
        let q = find(&m, "QUALITY");
        assert_eq!((q.kind, q.options.len(), q.options[4].1.as_str()), ("choice", 5, "Very high"));
        let d = find(&m, "DENSITY");
        assert_eq!((d.kind, d.min, d.max, d.step, d.percent), ("number", Some(0.0), Some(1.0), Some(0.05), true));
        assert!(m.sections.iter().flat_map(|s| &s.settings).all(|s| s.key != "SECRET"));
    }

    #[test]
    fn understands_the_other_spec_styles() {
        assert!(matches!(parse_spec("from 0 px to 512, round to 8"), Some(Spec::Range { max, step: Some(8.0), .. }) if max == 512.0));
        assert!(matches!(parse_spec("from -45° to 45"), Some(Spec::Range { min, .. }) if min == -45.0));
        assert!(matches!(parse_spec("from 0 s to 10, round to 0.5"), Some(Spec::Range { unit, .. }) if unit == "s"));
        let Some(Spec::Choice(c)) = parse_spec("Default is 0, Force disable is 1, \"Enable, middle part only\" is 4") else { panic!() };
        assert_eq!(c[2], ("4".to_string(), "Enable, middle part only".to_string()));
        let Some(Spec::Choice(c)) = parse_spec("-1 for Disabled, 0 for Left, 1 for Right") else { panic!() };
        assert_eq!(c[0].0, "-1");
        assert!(parse_spec("two numbers").is_none() && parse_spec("text").is_none() && parse_spec("color").is_none());
    }

    #[test]
    fn user_overrides_win_and_are_flagged() {
        let m = build("grass_fx", GRASS, "[BASIC]\nQUALITY=3\nDENSITY=0.50\n");
        assert_eq!((find(&m, "QUALITY").value.as_str(), find(&m, "QUALITY").changed), ("3", true));
        assert!(!find(&m, "DENSITY").changed, "0.50 = 0.5");
        assert_eq!(m.changed, 1);
    }

    #[test]
    fn writes_into_the_override_file_only_and_can_reset() {
        let root = std::env::temp_dir().join("nexora_cspcfg_test");
        let _ = fs::remove_dir_all(&root);
        let (config, over) = (root.join("config"), root.join("over"));
        fs::create_dir_all(&config).unwrap();
        fs::write(config.join("grass_fx.ini"), GRASS).unwrap();
        fs::write(config.join("data_countries.ini"), "[A]\nB=1\n").unwrap();

        let c = |s: &str, k: &str, v: &str| Change { section: s.into(), key: k.into(), value: v.into() };
        let m = write_values(&config, &over, "grass_fx", &[c("BASIC", "QUALITY", "4"), c("BASIC", "ENABLED", "0")]).unwrap();
        assert_eq!((find(&m, "QUALITY").value.as_str(), m.enabled), ("4", Some(false)));
        assert_eq!(fs::read_to_string(config.join("grass_fx.ini")).unwrap(), GRASS, "le fichier du patch reste intact");

        assert!(write_values(&config, &over, "grass_fx", &[c("BASIC", "SECRET", "1")]).is_err());
        assert!(write_values(&config, &over, "grass_fx", &[c("BASIC", "QUALITY", "1\n[X]")]).is_err());
        assert!(write_values(&config, &over, "data_countries", &[c("A", "B", "2")]).is_err());
        assert!(write_values(&config, &over, "../etc", &[]).is_err());

        let m = reset_module(&config, &over, "grass_fx").unwrap();
        assert_eq!((m.changed, m.enabled), (0, Some(true)));
        let ids: Vec<String> = list_modules(&config, &over).into_iter().map(|m| m.id).collect();
        assert_eq!(ids, vec!["grass_fx"], "les fichiers data_* ne sont pas des modules");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn parses_every_module_of_the_installed_patch() {
        // Ne plante sur aucun fichier réel (ignoré si le jeu n'est pas installé à cet endroit).
        let dir = Path::new("D:/SteamLibrary/steamapps/common/assettocorsa/extension/config");
        if !dir.is_dir() {
            return;
        }
        let modules = list_modules(dir, Path::new("Z:/nope"));
        assert!(modules.len() > 20);
        for id in module_ids(dir) {
            if let Ok(m) = load_module(dir, Path::new("Z:/nope"), &id) {
                for s in m.sections.iter().flat_map(|s| &s.settings) {
                    assert!(!s.key.is_empty() && !s.label.is_empty());
                }
            }
        }
    }
}
