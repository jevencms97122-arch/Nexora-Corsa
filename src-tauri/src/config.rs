use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default)]
pub struct AppConfig {
    pub ac_path: Option<String>,
    pub player_name: String,
}

fn config_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("config.json"))
}

pub fn load(app: &AppHandle) -> AppConfig {
    config_file(app)
        .ok()
        .and_then(|f| fs::read_to_string(f).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save(app: &AppHandle, cfg: &AppConfig) -> Result<(), String> {
    let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    fs::write(config_file(app)?, json).map_err(|e| e.to_string())
}

/// Dossier de travail de Nexora-Corsa (configs de serveur générées, etc.).
pub fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

#[tauri::command]
pub fn get_config(app: AppHandle) -> AppConfig {
    load(&app)
}

#[tauri::command]
pub fn set_player_name(app: AppHandle, name: String) -> Result<AppConfig, String> {
    let mut cfg = load(&app);
    cfg.player_name = name.trim().to_string();
    save(&app, &cfg)?;
    Ok(cfg)
}

#[tauri::command]
pub fn set_ac_path(app: AppHandle, path: String) -> Result<AppConfig, String> {
    let p = PathBuf::from(&path);
    crate::game::validate(&p)?;
    let mut cfg = load(&app);
    cfg.ac_path = Some(path);
    save(&app, &cfg)?;
    Ok(cfg)
}

/// Chemin du jeu configuré, ou une erreur claire.
pub fn require_ac(app: &AppHandle) -> Result<PathBuf, String> {
    let cfg = load(app);
    let path = cfg
        .ac_path
        .ok_or("Le dossier d'Assetto Corsa n'est pas configuré.")?;
    let p = PathBuf::from(path);
    crate::game::validate(&p)?;
    Ok(p)
}
