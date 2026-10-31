use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

const MAX_ENTRIES: usize = 100;

#[derive(Serialize, Deserialize, Clone)]
pub struct HistoryEntry {
    /// Secondes depuis l'epoch.
    pub ts: u64,
    /// "solo" | "join" | "host"
    pub kind: String,
    pub car: String,
    pub track: String,
    pub detail: String,
    /// Réglages complets, conservés seulement pour pouvoir relancer une session solo.
    pub solo: Option<serde_json::Value>,
}

fn file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(crate::config::data_dir(app)?.join("history.json"))
}

fn load(app: &AppHandle) -> Vec<HistoryEntry> {
    file(app)
        .ok()
        .and_then(|f| fs::read_to_string(f).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// Ajoute une entrée en tête de l'historique. Une erreur d'écriture ne doit jamais bloquer un lancement.
pub fn record(app: &AppHandle, kind: &str, car: &str, track: &str, detail: &str, solo: Option<serde_json::Value>) {
    let ts = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let mut entries = load(app);
    entries.insert(
        0,
        HistoryEntry { ts, kind: kind.into(), car: car.into(), track: track.into(), detail: detail.into(), solo },
    );
    entries.truncate(MAX_ENTRIES);
    if let (Ok(f), Ok(json)) = (file(app), serde_json::to_string(&entries)) {
        let _ = fs::write(f, json);
    }
}

#[tauri::command]
pub fn get_history(app: AppHandle) -> Vec<HistoryEntry> {
    load(&app)
}

#[tauri::command]
pub fn clear_history(app: AppHandle) -> Result<(), String> {
    fs::write(file(&app)?, "[]").map_err(|e| e.to_string())
}
