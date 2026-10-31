//! Page « Graphismes » : profils de qualité, filtres d'image et réglages de la météo.
//!
//! Tout est écrit dans les Documents de l'utilisateur (`Documents/Assetto Corsa/cfg`), jamais dans l'installation du jeu :
//! `video.ini` pour les réglages vidéo, `cfg/extension/<fichier>.ini` pour Custom Shaders Patch (qui fusionne ces
//! fichiers avec ses valeurs par défaut). Les fichiers sont sauvegardés avant la première modification.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

use crate::ini;

const STOCK_FILTERS: [&str; 10] =
    ["b&w", "blue_steel", "default", "default_bright", "default_dark", "movie", "natural", "photographic", "sepia", "vintage"];
pub(crate) const STOCK_WEATHER: [&str; 7] =
    ["1_heavy_fog", "2_light_fog", "3_clear", "4_mid_clear", "5_light_clouds", "6_mid_clouds", "7_heavy_clouds"];

// ---------------------------------------------------------------------------------------------
// Table des réglages
// ---------------------------------------------------------------------------------------------

/// Fichier visé : `video.ini`, ou un fichier de configuration de Custom Shaders Patch (nom sans `.ini`).
#[derive(Clone, Copy)]
enum Target {
    Video,
    Csp(&'static str),
}

/// Un réglage et sa valeur pour chacun des quatre profils (Équilibré, Élevé, Ultra, Cinéma).
#[derive(Clone, Copy)]
struct Row {
    target: Target,
    section: &'static str,
    key: &'static str,
    values: [&'static str; 4],
    /// Libellé et texte affiché sur la carte du profil ; absent = réglage appliqué sans être mis en avant.
    show: Option<(&'static str, [&'static str; 4])>,
}

const fn video(section: &'static str, key: &'static str, values: [&'static str; 4]) -> Row {
    Row { target: Target::Video, section, key, values, show: None }
}

const fn csp(file: &'static str, section: &'static str, key: &'static str, values: [&'static str; 4]) -> Row {
    Row { target: Target::Csp(file), section, key, values, show: None }
}

const fn shown(row: Row, label: &'static str, text: [&'static str; 4]) -> Row {
    Row { show: Some((label, text)), ..row }
}

const NO_YES: [&str; 4] = ["Non", "Oui", "Oui", "Oui"];

/// Toutes les clés ci-dessous existent dans les fichiers de Custom Shaders Patch 0.2.x et dans `video.ini`,
/// avec des valeurs dans les plages indiquées par leurs commentaires.
static ROWS: &[Row] = &[
    // --- Vidéo du jeu (video.ini)
    shown(video("VIDEO", "AASAMPLES", ["2", "4", "4", "8"]), "Anti-crénelage (MSAA)", ["2×", "4×", "4×", "8×"]),
    video("VIDEO", "ANISOTROPIC", ["16", "16", "16", "16"]),
    shown(video("VIDEO", "SHADOW_MAP_SIZE", ["2048", "4096", "4096", "8192"]), "Résolution des ombres", ["2048", "4096", "4096", "8192"]),
    video("ASSETTOCORSA", "WORLD_DETAIL", ["4", "5", "5", "5"]),
    video("MIRROR", "SIZE", ["512", "1024", "1024", "2048"]),
    video("MIRROR", "HQ", ["1", "1", "1", "1"]),
    video("CUBEMAP", "SIZE", ["1024", "2048", "2048", "2048"]),
    shown(video("POST_PROCESS", "QUALITY", ["3", "4", "5", "5"]), "Post-traitement", ["3/5", "4/5", "5/5", "5/5"]),
    video("POST_PROCESS", "GLARE", ["3", "4", "5", "5"]),
    video("EFFECTS", "SMOKE", ["3", "5", "5", "5"]),
    // --- Effets avancés (Extra FX)
    shown(csp("extra_fx", "BASIC", "ENABLED", ["1", "1", "1", "1"]), "Extra FX (effets avancés)", ["Oui", "Oui", "Oui", "Oui"]),
    csp("extra_fx", "TAA", "ENABLED", ["1", "1", "1", "1"]),
    shown(csp("extra_fx", "MOTION_BLUR", "ENABLED", ["0", "0", "0", "1"]), "Flou de mouvement", ["Non", "Non", "Non", "Oui"]),
    shown(csp("extra_fx", "SSLR", "ENABLED", ["0", "1", "1", "1"]), "Reflets sur piste mouillée", NO_YES),
    csp("extra_fx", "SSLR", "TRACING_QUALITY3", ["3", "3", "4", "4"]),
    shown(csp("extra_fx", "ASSAO", "ENABLED", ["0", "1", "1", "1"]), "Occlusion ambiante", NO_YES),
    csp("extra_fx", "ASSAO", "QUALITY", ["1", "1", "2", "3"]),
    csp("extra_fx", "SS_LIGHTING", "ENABLED", ["1", "1", "1", "1"]),
    csp("extra_fx", "SS_LIGHTING", "SCALE", ["0.5", "0.75", "1", "1"]),
    shown(csp("extra_fx", "VOLUMETRIC_LIGHTS", "ENABLED", ["0", "1", "1", "1"]), "Lumières volumétriques", NO_YES),
    csp("extra_fx", "VOLUMETRIC_LIGHTS", "SCALE", ["0.16", "0.16", "0.2", "0.28"]),
    csp("extra_fx", "FOG_BLUR", "ENABLED", ["1", "1", "1", "1"]),
    shown(csp("extra_fx", "SSGI", "ENABLED2", ["0", "0", "0", "1"]), "Éclairage indirect (SSGI)", ["Non", "Non", "Non", "Oui"]),
    // --- Lumières, herbe, reflets, météo, distance d'affichage
    shown(csp("lighting_fx", "SHADOWS", "ENABLED", ["0", "0", "1", "1"]), "Ombres des lumières dynamiques", ["Non", "Non", "Oui", "Oui"]),
    csp("lighting_fx", "SHADOWS", "CARS_SHADOWS", ["2", "2", "3", "4"]),
    csp("lighting_fx", "PERFORMANCE", "CARS_WITH_LIGHTS", ["6", "10", "16", "24"]),
    shown(csp("grass_fx", "BASIC", "QUALITY", ["2", "3", "4", "4"]), "Herbe", ["Moyenne", "Haute", "Très haute", "Très haute"]),
    csp("grass_fx", "RENDERING", "EXTRAFX_PASS", ["0", "1", "1", "1"]),
    csp("grass_fx", "RENDERING", "CAST_SHADOWS", ["0", "0", "1", "1"]),
    shown(csp("reflections_fx", "MAIN_CUBEMAP", "RESOLUTION2", ["256", "512", "1024", "1024"]), "Reflets de l'environnement", ["256 px", "512 px", "1024 px", "1024 px"]),
    csp("weather_fx", "PERFORMANCE", "DETAILED_CLOUD_SHADOWS", ["0", "0", "1", "1"]),
    csp("weather_fx", "PERFORMANCE", "SLOW_REFLECTIONS_UPDATE", ["1", "0", "0", "0"]),
    shown(csp("graphics_adjustments", "LODS", "CARS_DISTANCE_MULT", ["1", "1.3", "1.8", "2.5"]), "Distance d'affichage", ["×1", "×1,3", "×1,8", "×2,5"]),
    csp("graphics_adjustments", "LODS", "TRACK_DISTANCE_MULT", ["1", "1.3", "1.8", "2.5"]),
    csp("graphics_adjustments", "LODS", "TREES_DISTANCE_MULT", ["1", "1.3", "1.8", "2.5"]),
    csp("particles_fx", "AC_PARTICLES", "SHADOWS_RESOLUTION", ["128", "256", "512", "512"]),
];

struct Meta {
    id: &'static str,
    name: &'static str,
    tagline: &'static str,
}

const PROFILES: [Meta; 4] = [
    Meta { id: "balanced", name: "Équilibré", tagline: "Fluide partout, effets de base" },
    Meta { id: "high", name: "Élevé", tagline: "Beau et fluide sur un bon PC" },
    Meta { id: "ultra", name: "Ultra", tagline: "Tous les effets, pour une carte récente" },
    Meta { id: "cinema", name: "Cinéma", tagline: "Qualité maximale pour replays et photos" },
];

// ---------------------------------------------------------------------------------------------
// Chemins et lecture
// ---------------------------------------------------------------------------------------------

fn read(path: &Path) -> String {
    fs::read(path).map(|b| String::from_utf8_lossy(&b).trim_start_matches('\u{feff}').to_string()).unwrap_or_default()
}

fn target_file(cfg: &Path, target: Target) -> PathBuf {
    match target {
        Target::Video => cfg.join("video.ini"),
        Target::Csp(name) => cfg.join("extension").join(format!("{name}.ini")),
    }
}

/// Valeur réellement utilisée : celle de l'utilisateur, sinon la valeur par défaut de Custom Shaders Patch.
fn effective(ac: &Path, cfg: &Path, row: &Row) -> Option<String> {
    let user = ini::get(&read(&target_file(cfg, row.target)), row.section, row.key);
    match (row.target, user) {
        (_, Some(v)) => Some(v),
        (Target::Csp(name), None) => ini::get(&read(&ac.join("extension").join("config").join(format!("{name}.ini"))), row.section, row.key),
        (Target::Video, None) => None,
    }
}

fn same(a: &str, b: &str) -> bool {
    match (a.trim().parse::<f64>(), b.trim().parse::<f64>()) {
        (Ok(x), Ok(y)) => (x - y).abs() < 1e-9,
        _ => a.trim().eq_ignore_ascii_case(b.trim()),
    }
}

fn applies(row: &Row, csp_installed: bool) -> bool {
    csp_installed || matches!(row.target, Target::Video)
}

/// Tous les fichiers que la page peut modifier (pour la sauvegarde).
fn managed_files(cfg: &Path) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = vec![target_file(cfg, Target::Video)];
    for row in ROWS {
        let f = target_file(cfg, row.target);
        if !files.contains(&f) {
            files.push(f);
        }
    }
    files
}

// ---------------------------------------------------------------------------------------------
// Sauvegarde / restauration
// ---------------------------------------------------------------------------------------------

#[derive(Serialize, Deserialize)]
struct BackupEntry {
    path: PathBuf,
    /// Copie dans le dossier de sauvegarde ; absente si le fichier n'existait pas avant nous.
    copy: Option<String>,
}

/// Copie les fichiers d'origine, une seule fois (jusqu'à la prochaine restauration).
fn ensure_backup(backup: &Path, files: &[PathBuf]) -> Result<(), String> {
    let manifest = backup.join("manifest.json");
    if manifest.is_file() {
        return Ok(());
    }
    fs::create_dir_all(backup).map_err(|e| e.to_string())?;
    let mut entries = vec![];
    for (i, path) in files.iter().enumerate() {
        let copy = if path.is_file() {
            let name = format!("{i}.bak");
            fs::copy(path, backup.join(&name)).map_err(|e| format!("Sauvegarde de {} impossible : {e}", path.display()))?;
            Some(name)
        } else {
            None
        };
        entries.push(BackupEntry { path: path.clone(), copy });
    }
    let json = serde_json::to_string_pretty(&entries).map_err(|e| e.to_string())?;
    fs::write(manifest, json).map_err(|e| e.to_string())
}

fn restore_from(backup: &Path) -> Result<(), String> {
    let text = fs::read_to_string(backup.join("manifest.json")).map_err(|_| "Aucune sauvegarde à restaurer.".to_string())?;
    let entries: Vec<BackupEntry> = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    for e in &entries {
        match &e.copy {
            Some(name) => {
                fs::copy(backup.join(name), &e.path).map_err(|err| format!("Restauration de {} impossible : {err}", e.path.display()))?;
            }
            // Fichier créé par Nexora-Corsa : on le supprime pour retrouver l'état d'origine.
            None => {
                let _ = fs::remove_file(&e.path);
            }
        }
    }
    fs::remove_dir_all(backup).map_err(|e| e.to_string())
}

fn backup_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(crate::config::data_dir(app)?.join("graphics-backup"))
}

// ---------------------------------------------------------------------------------------------
// Profils
// ---------------------------------------------------------------------------------------------

#[derive(Serialize)]
pub struct Highlight {
    label: &'static str,
    value: &'static str,
}

#[derive(Serialize)]
pub struct ProfileView {
    id: &'static str,
    name: &'static str,
    tagline: &'static str,
    highlights: Vec<Highlight>,
    /// Les fichiers de l'utilisateur correspondent exactement à ce profil.
    matches: bool,
}

#[derive(Serialize)]
pub struct GraphicsState {
    csp_installed: bool,
    profiles: Vec<ProfileView>,
    /// Profil dont tous les réglages sont actuellement en place.
    active: Option<&'static str>,
    has_backup: bool,
}

fn state_for(ac: &Path, cfg: &Path, backup: &Path) -> GraphicsState {
    let csp_installed = crate::csp::status(ac).installed;
    let profiles: Vec<ProfileView> = PROFILES
        .iter()
        .enumerate()
        .map(|(i, meta)| ProfileView {
            id: meta.id,
            name: meta.name,
            tagline: meta.tagline,
            highlights: ROWS.iter().filter_map(|r| r.show.map(|(label, text)| Highlight { label, value: text[i] })).collect(),
            matches: ROWS
                .iter()
                .filter(|r| applies(r, csp_installed))
                .all(|r| effective(ac, cfg, r).is_some_and(|v| same(&v, r.values[i]))),
        })
        .collect();
    let active = profiles.iter().find(|p| p.matches).map(|p| p.id);
    GraphicsState { csp_installed, profiles, active, has_backup: backup.join("manifest.json").is_file() }
}

fn apply_to(ac: &Path, cfg: &Path, backup: &Path, id: &str) -> Result<(), String> {
    let index = PROFILES.iter().position(|p| p.id == id).ok_or_else(|| format!("Profil inconnu : {id}"))?;
    let csp_installed = crate::csp::status(ac).installed;
    ensure_backup(backup, &managed_files(cfg))?;
    fs::create_dir_all(cfg.join("extension")).map_err(|e| e.to_string())?;

    let mut per_file: HashMap<PathBuf, Vec<(&str, &str, String)>> = HashMap::new();
    for row in ROWS.iter().filter(|r| applies(r, csp_installed)) {
        per_file.entry(target_file(cfg, row.target)).or_default().push((row.section, row.key, row.values[index].to_string()));
    }
    for (file, updates) in per_file {
        let merged = ini::set_values(&read(&file), &updates);
        fs::write(&file, merged).map_err(|e| format!("Écriture de {} impossible : {e}", file.display()))?;
    }
    Ok(())
}

/// Dossiers du jeu et des réglages de l'utilisateur.
fn paths(app: &AppHandle) -> Result<(PathBuf, PathBuf, PathBuf), String> {
    Ok((crate::config::require_ac(app)?, crate::race::cfg_dir()?, backup_dir(app)?))
}

#[tauri::command]
pub fn graphics_state(app: AppHandle) -> Result<GraphicsState, String> {
    let (ac, cfg, backup) = paths(&app)?;
    Ok(state_for(&ac, &cfg, &backup))
}

#[tauri::command]
pub fn apply_graphics_profile(app: AppHandle, profile: String) -> Result<GraphicsState, String> {
    let (ac, cfg, backup) = paths(&app)?;
    apply_to(&ac, &cfg, &backup, &profile)?;
    Ok(state_for(&ac, &cfg, &backup))
}

#[tauri::command]
pub fn restore_graphics(app: AppHandle) -> Result<GraphicsState, String> {
    let (ac, cfg, backup) = paths(&app)?;
    restore_from(&backup)?;
    Ok(state_for(&ac, &cfg, &backup))
}

// ---------------------------------------------------------------------------------------------
// Filtres d'image
// ---------------------------------------------------------------------------------------------

#[derive(Serialize)]
pub struct FilterInfo {
    id: String,
    /// Filtre fourni avec le jeu (sinon : ajouté par l'utilisateur).
    builtin: bool,
    active: bool,
}

fn filters_dir(ac: &Path) -> PathBuf {
    ac.join("system").join("cfg").join("ppfilters")
}

fn list_filters_in(ac: &Path, cfg: &Path) -> Vec<FilterInfo> {
    let current = ini::get(&read(&cfg.join("video.ini")), "POST_PROCESS", "FILTER").unwrap_or_else(|| "default".into());
    let mut ids: Vec<String> = fs::read_dir(filters_dir(ac))
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let p = e.path();
            (p.extension().is_some_and(|x| x.eq_ignore_ascii_case("ini"))).then(|| p.file_stem().map(|s| s.to_string_lossy().into_owned()))?
        })
        .collect();
    ids.sort_by_key(|s| s.to_lowercase());
    ids.into_iter()
        .map(|id| FilterInfo { builtin: STOCK_FILTERS.iter().any(|s| s.eq_ignore_ascii_case(&id)), active: id.eq_ignore_ascii_case(&current), id })
        .collect()
}

#[tauri::command]
pub fn list_filters(app: AppHandle) -> Result<Vec<FilterInfo>, String> {
    let (ac, cfg, _) = paths(&app)?;
    Ok(list_filters_in(&ac, &cfg))
}

fn set_filter_in(ac: &Path, cfg: &Path, backup: &Path, id: &str) -> Result<(), String> {
    if !list_filters_in(ac, cfg).iter().any(|f| f.id == id) {
        return Err(format!("Filtre introuvable : {id}"));
    }
    ensure_backup(backup, &managed_files(cfg))?;
    let file = cfg.join("video.ini");
    fs::write(&file, ini::set_values(&read(&file), &[("POST_PROCESS", "FILTER", id.to_string())]))
        .map_err(|e| format!("Écriture de video.ini impossible : {e}"))
}

#[tauri::command]
pub fn set_filter(app: AppHandle, filter: String) -> Result<Vec<FilterInfo>, String> {
    let (ac, cfg, backup) = paths(&app)?;
    set_filter_in(&ac, &cfg, &backup, &filter)?;
    Ok(list_filters_in(&ac, &cfg))
}

// ---------------------------------------------------------------------------------------------
// Ciel et météo
// ---------------------------------------------------------------------------------------------

#[derive(Serialize)]
pub struct WeatherPreset {
    id: String,
    builtin: bool,
}

#[derive(Serialize)]
pub struct WeatherOptions {
    /// Scripts qui pilotent l'heure et les conditions (dossiers de `extension/weather-controllers`).
    controllers: Vec<String>,
    /// Styles de ciel et de nuages (dossiers de `extension/weather`).
    implementations: Vec<String>,
    controller: String,
    implementation: String,
    /// Réglages météo présents dans `content/weather` (nuages, brouillard, ciel dégagé…).
    presets: Vec<WeatherPreset>,
    csp_installed: bool,
}

fn dirs_in(path: &Path) -> Vec<String> {
    let mut v: Vec<String> = fs::read_dir(path)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.path().is_dir())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    v.sort_by_key(|s| s.to_lowercase());
    v
}

fn weather_options_for(ac: &Path, cfg: &Path) -> WeatherOptions {
    let get = |key: &str| {
        let user = ini::get(&read(&target_file(cfg, Target::Csp("weather_fx"))), "BASIC", key);
        user.or_else(|| ini::get(&read(&ac.join("extension").join("config").join("weather_fx.ini")), "BASIC", key)).unwrap_or_default()
    };
    WeatherOptions {
        controllers: dirs_in(&ac.join("extension").join("weather-controllers")),
        implementations: dirs_in(&ac.join("extension").join("weather")),
        controller: get("CONTROLLER"),
        implementation: get("IMPLEMENTATION"),
        presets: dirs_in(&ac.join("content").join("weather"))
            .into_iter()
            .map(|id| WeatherPreset { builtin: STOCK_WEATHER.contains(&id.as_str()), id })
            .collect(),
        csp_installed: crate::csp::status(ac).installed,
    }
}

#[tauri::command]
pub fn weather_options(app: AppHandle) -> Result<WeatherOptions, String> {
    let (ac, cfg, _) = paths(&app)?;
    Ok(weather_options_for(&ac, &cfg))
}

fn set_weather_in(ac: &Path, cfg: &Path, backup: &Path, controller: &str, implementation: &str) -> Result<(), String> {
    let known = weather_options_for(ac, cfg);
    if !known.controllers.iter().any(|c| c == controller) {
        return Err(format!("Contrôleur de météo introuvable : {controller}"));
    }
    if !known.implementations.iter().any(|i| i == implementation) {
        return Err(format!("Style de ciel introuvable : {implementation}"));
    }
    ensure_backup(backup, &managed_files(cfg))?;
    fs::create_dir_all(cfg.join("extension")).map_err(|e| e.to_string())?;
    let file = target_file(cfg, Target::Csp("weather_fx"));
    let updates = [("BASIC", "CONTROLLER", controller.to_string()), ("BASIC", "IMPLEMENTATION", implementation.to_string())];
    fs::write(&file, ini::set_values(&read(&file), &updates)).map_err(|e| format!("Écriture de weather_fx.ini impossible : {e}"))
}

#[tauri::command]
pub fn set_weather(app: AppHandle, controller: String, implementation: String) -> Result<WeatherOptions, String> {
    let (ac, cfg, backup) = paths(&app)?;
    set_weather_in(&ac, &cfg, &backup, &controller, &implementation)?;
    Ok(weather_options_for(&ac, &cfg))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Faux jeu et faux dossier d'utilisateur, avec les valeurs par défaut de Custom Shaders Patch.
    fn setup(name: &str, with_csp: bool) -> (PathBuf, PathBuf, PathBuf) {
        let root = std::env::temp_dir().join(format!("nexora_gfx_{name}"));
        let _ = fs::remove_dir_all(&root);
        let (ac, cfg, backup) = (root.join("ac"), root.join("docs").join("cfg"), root.join("backup"));
        fs::create_dir_all(cfg.join("extension")).unwrap();
        fs::create_dir_all(ac.join("extension").join("config")).unwrap();
        fs::create_dir_all(ac.join("system").join("cfg").join("ppfilters")).unwrap();
        fs::write(
            cfg.join("video.ini"),
            "[VIDEO]\r\nAASAMPLES=4\r\nWIDTH=2560\r\nHEIGHT=1440\r\n\r\n[POST_PROCESS]\r\nFILTER=default\r\nQUALITY=5\r\n",
        )
        .unwrap();
        if with_csp {
            fs::write(ac.join("dwrite.dll"), "x").unwrap();
            let cfgdir = ac.join("extension").join("config");
            fs::write(cfgdir.join("extra_fx.ini"), "[BASIC]\r\nENABLED=0 ; Active; 1 or 0\r\n[SSLR]\r\nENABLED=1\r\n").unwrap();
            fs::write(cfgdir.join("weather_fx.ini"), "[BASIC]\r\nCONTROLLER=sol\r\nIMPLEMENTATION=base\r\n").unwrap();
        }
        (ac, cfg, backup)
    }

    #[test]
    fn rows_are_consistent() {
        // chaque profil a une valeur pour chaque réglage, et les libellés mis en avant couvrent les quatre profils
        for r in ROWS {
            assert!(r.values.iter().all(|v| !v.is_empty()));
        }
        assert!(ROWS.iter().filter(|r| r.show.is_some()).count() >= 8);
        // pas de doublon (section, clé, fichier) : le dernier écraserait silencieusement le premier
        let mut seen = std::collections::HashSet::new();
        for r in ROWS {
            let t = match r.target {
                Target::Video => "video".to_string(),
                Target::Csp(n) => n.to_string(),
            };
            assert!(seen.insert((t, r.section, r.key)), "doublon : {} {}", r.section, r.key);
        }
    }

    #[test]
    fn applying_a_profile_writes_and_is_detected() {
        let (ac, cfg, backup) = setup("apply", true);
        assert!(state_for(&ac, &cfg, &backup).active.is_none());
        apply_to(&ac, &cfg, &backup, "ultra").unwrap();
        let s = state_for(&ac, &cfg, &backup);
        assert_eq!(s.active, Some("ultra"));
        assert!(s.has_backup && s.csp_installed);
        // vidéo : seules les clés du profil bougent
        let video = read(&cfg.join("video.ini"));
        assert_eq!(ini::get(&video, "VIDEO", "AASAMPLES").as_deref(), Some("4"));
        assert_eq!(ini::get(&video, "VIDEO", "WIDTH").as_deref(), Some("2560"));
        assert_eq!(ini::get(&video, "VIDEO", "SHADOW_MAP_SIZE").as_deref(), Some("4096"));
        // CSP : écrit dans les Documents, jamais dans le jeu
        let extra = read(&cfg.join("extension").join("extra_fx.ini"));
        assert_eq!(ini::get(&extra, "BASIC", "ENABLED").as_deref(), Some("1"));
        assert_eq!(ini::get(&extra, "VOLUMETRIC_LIGHTS", "SCALE").as_deref(), Some("0.2"));
        assert!(read(&ac.join("extension").join("config").join("extra_fx.ini")).contains("ENABLED=0"));
        apply_to(&ac, &cfg, &backup, "cinema").unwrap();
        assert_eq!(state_for(&ac, &cfg, &backup).active, Some("cinema"));
        assert!(apply_to(&ac, &cfg, &backup, "inconnu").is_err());
    }

    #[test]
    fn restore_brings_back_the_original_files() {
        let (ac, cfg, backup) = setup("restore", true);
        let original_video = read(&cfg.join("video.ini"));
        apply_to(&ac, &cfg, &backup, "balanced").unwrap();
        apply_to(&ac, &cfg, &backup, "high").unwrap(); // la 2e application ne doit pas écraser la sauvegarde
        assert_ne!(read(&cfg.join("video.ini")), original_video);
        assert!(cfg.join("extension").join("extra_fx.ini").is_file());
        restore_from(&backup).unwrap();
        assert_eq!(read(&cfg.join("video.ini")), original_video);
        assert!(!cfg.join("extension").join("extra_fx.ini").exists(), "un fichier créé par nous doit disparaître");
        assert!(!backup.exists());
        assert!(restore_from(&backup).is_err());
    }

    #[test]
    fn without_csp_only_the_video_part_is_applied() {
        let (ac, cfg, backup) = setup("nocsp", false);
        apply_to(&ac, &cfg, &backup, "high").unwrap();
        let s = state_for(&ac, &cfg, &backup);
        assert!(!s.csp_installed);
        assert_eq!(s.active, Some("high"));
        assert!(!cfg.join("extension").join("extra_fx.ini").exists());
        assert_eq!(ini::get(&read(&cfg.join("video.ini")), "VIDEO", "SHADOW_MAP_SIZE").as_deref(), Some("4096"));
    }

    #[test]
    fn filters_are_listed_and_selected() {
        let (ac, cfg, backup) = setup("filters", true);
        let dir = filters_dir(&ac);
        for n in ["default", "natural", "mon_filtre"] {
            fs::write(dir.join(format!("{n}.ini")), "[YEBIS]\r\nENABLED=1\r\n").unwrap();
        }
        let list = list_filters_in(&ac, &cfg);
        assert_eq!(list.iter().map(|f| f.id.as_str()).collect::<Vec<_>>(), ["default", "mon_filtre", "natural"]);
        assert!(list.iter().find(|f| f.id == "default").unwrap().active);
        assert!(!list.iter().find(|f| f.id == "mon_filtre").unwrap().builtin);
        set_filter_in(&ac, &cfg, &backup, "mon_filtre").unwrap();
        assert!(list_filters_in(&ac, &cfg).iter().find(|f| f.id == "mon_filtre").unwrap().active);
        assert!(set_filter_in(&ac, &cfg, &backup, "../evil").is_err());
        assert!(set_filter_in(&ac, &cfg, &backup, "absent").is_err());
    }

    #[test]
    fn weather_controller_and_style_are_validated() {
        let (ac, cfg, backup) = setup("weather", true);
        fs::create_dir_all(ac.join("extension").join("weather-controllers").join("base")).unwrap();
        fs::create_dir_all(ac.join("extension").join("weather-controllers").join("pure")).unwrap();
        fs::create_dir_all(ac.join("extension").join("weather").join("base")).unwrap();
        fs::create_dir_all(ac.join("content").join("weather").join("3_clear")).unwrap();
        fs::create_dir_all(ac.join("content").join("weather").join("sol_01")).unwrap();
        let o = weather_options_for(&ac, &cfg);
        assert_eq!((o.controller.as_str(), o.implementation.as_str()), ("sol", "base"));
        assert!(o.presets.iter().any(|p| p.id == "3_clear" && p.builtin));
        assert!(o.presets.iter().any(|p| p.id == "sol_01" && !p.builtin));
        set_weather_in(&ac, &cfg, &backup, "pure", "base").unwrap();
        assert_eq!(weather_options_for(&ac, &cfg).controller, "pure");
        assert!(set_weather_in(&ac, &cfg, &backup, "../x", "base").is_err());
        assert!(set_weather_in(&ac, &cfg, &backup, "pure", "inconnu").is_err());
    }
}
