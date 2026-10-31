use base64::Engine;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

#[derive(Serialize)]
pub struct Car {
    pub id: String,
    pub name: String,
    pub brand: String,
    pub skins: Vec<String>,
}

#[derive(Serialize)]
pub struct TrackLayout {
    pub id: String,
    pub name: String,
}

#[derive(Serialize)]
pub struct Track {
    pub id: String,
    pub name: String,
    pub layouts: Vec<TrackLayout>,
}

/// Vérifie qu'un dossier est bien une installation d'Assetto Corsa.
pub fn validate(path: &Path) -> Result<(), String> {
    if !path.join("acs.exe").is_file() {
        return Err("acs.exe introuvable : ce dossier n'est pas Assetto Corsa.".into());
    }
    if !path.join("content").join("cars").is_dir() || !path.join("content").join("tracks").is_dir() {
        return Err("Le dossier « content » du jeu est incomplet.".into());
    }
    Ok(())
}

/// Refuse tout identifiant qui pourrait sortir du dossier de contenu.
fn safe_id(id: &str) -> Result<&str, String> {
    if id.is_empty() || id.contains(['/', '\\']) || id.contains("..") {
        return Err(format!("Identifiant invalide : {id}"));
    }
    Ok(id)
}

fn steam_root() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        use winreg::RegKey;
        use winreg::enums::HKEY_CURRENT_USER;
        if let Ok(key) = RegKey::predef(HKEY_CURRENT_USER).open_subkey("Software\\Valve\\Steam") {
            if let Ok(p) = key.get_value::<String, _>("SteamPath") {
                let p = PathBuf::from(p.replace('/', "\\"));
                if p.is_dir() {
                    return Some(p);
                }
            }
        }
    }
    let fallback = PathBuf::from(r"C:\Program Files (x86)\Steam");
    fallback.is_dir().then_some(fallback)
}

/// Valeurs entre guillemets d'une ligne VDF : `"key"   "value"`.
fn vdf_pair(line: &str) -> Option<(String, String)> {
    let mut parts = line.split('"').skip(1).step_by(2);
    Some((parts.next()?.to_string(), parts.next()?.to_string()))
}

fn library_folders() -> Vec<PathBuf> {
    let Some(root) = steam_root() else { return vec![] };
    let mut libs = vec![root.clone()];
    if let Ok(text) = fs::read_to_string(root.join("steamapps").join("libraryfolders.vdf")) {
        for line in text.lines() {
            if let Some((k, v)) = vdf_pair(line) {
                if k == "path" {
                    libs.push(PathBuf::from(v.replace("\\\\", "\\")));
                }
            }
        }
    }
    libs
}

/// SteamID64 du dernier compte Steam connecté (nécessaire pour rejoindre un serveur).
pub fn steam_id() -> Option<String> {
    let root = steam_root()?;
    let text = fs::read_to_string(root.join("config").join("loginusers.vdf")).ok()?;
    let mut current: Option<String> = None;
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('"') && !trimmed.contains("\"\t") && trimmed.matches('"').count() == 2 {
            let id = trimmed.trim_matches('"');
            if id.len() >= 15 && id.chars().all(|c| c.is_ascii_digit()) {
                current = Some(id.to_string());
            }
        } else if let Some((k, v)) = vdf_pair(trimmed) {
            if k == "MostRecent" && v == "1" {
                return current;
            }
        }
    }
    None
}

#[tauri::command]
pub fn detect_game() -> Vec<String> {
    library_folders()
        .into_iter()
        .map(|l| l.join("steamapps").join("common").join("assettocorsa"))
        .filter(|p| validate(p).is_ok())
        .map(|p| p.to_string_lossy().into_owned())
        .collect()
}

#[tauri::command]
pub fn check_game_path(path: String) -> Result<(), String> {
    validate(Path::new(&path))
}

/// Les `ui_*.json` d'AC contiennent souvent des retours à la ligne dans les chaînes,
/// donc du JSON invalide : on extrait simplement la première valeur de la clé voulue.
fn json_field(text: &str, key: &str) -> Option<String> {
    let needle = format!("\"{key}\"");
    let rest = &text[text.find(&needle)? + needle.len()..];
    let rest = rest.trim_start().strip_prefix(':')?.trim_start().strip_prefix('"')?;
    let mut out = String::new();
    let mut chars = rest.chars();
    while let Some(c) = chars.next() {
        match c {
            '"' => return Some(out.trim().to_string()),
            '\\' => {
                if let Some(n) = chars.next() {
                    out.push(match n {
                        'n' | 't' => ' ',
                        other => other,
                    });
                }
            }
            other => out.push(other),
        }
    }
    None
}

fn read_text(path: &Path) -> Option<String> {
    fs::read(path).ok().map(|b| String::from_utf8_lossy(&b).into_owned())
}

fn subdirs(path: &Path) -> Vec<String> {
    let mut v: Vec<String> = fs::read_dir(path)
        .map(|it| {
            it.flatten()
                .filter(|e| e.path().is_dir())
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default();
    v.sort_by_key(|s| s.to_lowercase());
    v
}

#[tauri::command]
pub fn list_cars(app: AppHandle) -> Result<Vec<Car>, String> {
    let ac = crate::config::require_ac(&app)?;
    let dir = ac.join("content").join("cars");
    let mut cars: Vec<Car> = subdirs(&dir)
        .into_iter()
        .map(|id| {
            let ui = read_text(&dir.join(&id).join("ui").join("ui_car.json")).unwrap_or_default();
            Car {
                name: json_field(&ui, "name").unwrap_or_else(|| id.clone()),
                brand: json_field(&ui, "brand").unwrap_or_default(),
                skins: subdirs(&dir.join(&id).join("skins")),
                id,
            }
        })
        .filter(|c| !c.skins.is_empty())
        .collect();
    cars.sort_by_key(|c| c.name.to_lowercase());
    Ok(cars)
}

#[tauri::command]
pub fn list_tracks(app: AppHandle) -> Result<Vec<Track>, String> {
    let ac = crate::config::require_ac(&app)?;
    let dir = ac.join("content").join("tracks");
    let mut tracks: Vec<Track> = subdirs(&dir)
        .into_iter()
        .filter_map(|id| {
            let ui_dir = dir.join(&id).join("ui");
            let mut layouts = vec![];
            let mut name = None;
            if let Some(ui) = read_text(&ui_dir.join("ui_track.json")) {
                name = json_field(&ui, "name");
                layouts.push(TrackLayout { id: String::new(), name: name.clone().unwrap_or_default() });
            }
            for layout in subdirs(&ui_dir) {
                if let Some(ui) = read_text(&ui_dir.join(&layout).join("ui_track.json")) {
                    let lname = json_field(&ui, "name").unwrap_or_else(|| layout.clone());
                    name.get_or_insert_with(|| lname.clone());
                    layouts.push(TrackLayout { id: layout, name: lname });
                }
            }
            if layouts.is_empty() {
                return None;
            }
            Some(Track { name: name.unwrap_or_else(|| id.clone()), id, layouts })
        })
        .collect();
    tracks.sort_by_key(|t| t.name.to_lowercase());
    Ok(tracks)
}

#[tauri::command]
pub fn list_weathers(app: AppHandle) -> Result<Vec<String>, String> {
    let ac = crate::config::require_ac(&app)?;
    Ok(subdirs(&ac.join("content").join("weather")))
}

fn data_url(path: &Path) -> Option<String> {
    let bytes = fs::read(path).ok()?;
    let mime = match path.extension()?.to_str()?.to_lowercase().as_str() {
        "png" => "image/png",
        _ => "image/jpeg",
    };
    Some(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

#[tauri::command]
pub fn car_preview(app: AppHandle, car: String, skin: String) -> Result<Option<String>, String> {
    let ac = crate::config::require_ac(&app)?;
    let skin_dir = ac.join("content").join("cars").join(safe_id(&car)?).join("skins").join(safe_id(&skin)?);
    Ok(["preview.jpg", "preview.png"].iter().find_map(|f| data_url(&skin_dir.join(f))))
}

#[tauri::command]
pub fn track_preview(app: AppHandle, track: String, layout: String) -> Result<Option<String>, String> {
    let ac = crate::config::require_ac(&app)?;
    let ui = ac.join("content").join("tracks").join(safe_id(&track)?).join("ui");
    let ui = if layout.is_empty() { ui } else { ui.join(safe_id(&layout)?) };
    Ok(["preview.png", "preview.jpg", "outline.png"].iter().find_map(|f| data_url(&ui.join(f))))
}
