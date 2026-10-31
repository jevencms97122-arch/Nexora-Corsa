use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io;
use std::path::{Component, Path, PathBuf};
use tauri::AppHandle;
use zip::ZipArchive;

#[derive(Serialize, Deserialize, Clone, PartialEq)]
pub struct InstalledMod {
    /// "car" ou "track"
    pub kind: String,
    pub id: String,
}

#[derive(Serialize)]
pub struct ModInfo {
    pub kind: String,
    pub id: String,
    /// Un contenu de même identifiant est déjà installé.
    pub exists: bool,
    /// Ce contenu a été installé par Nexora-Corsa (donc désinstallable).
    pub managed: bool,
}

/// Un mod détecté dans l'archive : sa racine dans le zip (vide si l'archive *est* le mod).
struct Detected {
    kind: &'static str,
    id: String,
    root: Vec<String>,
}

fn components(path: &Path) -> Vec<String> {
    path.components()
        .filter_map(|c| match c {
            Component::Normal(s) => Some(s.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect()
}

fn safe_id(id: &str) -> bool {
    !id.is_empty() && id != "." && id != ".." && !id.contains(['/', '\\', ':'])
}

fn archive_stem(zip_path: &Path) -> String {
    zip_path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default()
}

/// Repère les voitures et circuits d'une archive grâce à leurs fichiers `ui_car.json` / `ui_track.json`.
fn detect(archive: &mut ZipArchive<File>, zip_path: &Path) -> Result<Vec<Detected>, String> {
    let mut found: Vec<Detected> = vec![];
    for i in 0..archive.len() {
        let file = archive.by_index(i).map_err(|e| format!("Archive illisible : {e}"))?;
        let Some(path) = file.enclosed_name() else { continue };
        let comps = components(&path);
        let Some(pos) = comps.iter().position(|c| c.eq_ignore_ascii_case("ui")) else { continue };
        let rest = &comps[pos + 1..];
        let kind = match rest {
            [f] if f.eq_ignore_ascii_case("ui_car.json") => "car",
            [f] if f.eq_ignore_ascii_case("ui_track.json") => "track",
            [_, f] if f.eq_ignore_ascii_case("ui_track.json") => "track",
            _ => continue,
        };
        let root = comps[..pos].to_vec();
        if found.iter().any(|d| d.kind == kind && d.root == root) {
            continue;
        }
        let id = root.last().cloned().unwrap_or_else(|| archive_stem(zip_path));
        if !safe_id(&id) {
            return Err(format!("Nom de mod invalide : {id}"));
        }
        found.push(Detected { kind, id, root });
    }
    if found.is_empty() {
        return Err("Aucune voiture ni aucun circuit reconnu dans cette archive (ui_car.json / ui_track.json absents).".into());
    }
    Ok(found)
}

fn content_dir(ac: &Path, kind: &str) -> PathBuf {
    ac.join("content").join(if kind == "car" { "cars" } else { "tracks" })
}

fn manifest_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(crate::config::data_dir(app)?.join("mods.json"))
}

fn load_manifest(app: &AppHandle) -> Vec<InstalledMod> {
    manifest_path(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_manifest(app: &AppHandle, mods: &[InstalledMod]) -> Result<(), String> {
    let json = serde_json::to_string_pretty(mods).map_err(|e| e.to_string())?;
    fs::write(manifest_path(app)?, json).map_err(|e| e.to_string())
}

fn open_zip(path: &str) -> Result<(ZipArchive<File>, PathBuf), String> {
    let p = PathBuf::from(path);
    let file = File::open(&p).map_err(|e| format!("Impossible d'ouvrir l'archive : {e}"))?;
    let archive = ZipArchive::new(file).map_err(|_| "Ce fichier n'est pas une archive .zip valide.".to_string())?;
    Ok((archive, p))
}

fn inspect(app: &AppHandle, path: &str) -> Result<Vec<ModInfo>, String> {
    let ac = crate::config::require_ac(app)?;
    let (mut archive, p) = open_zip(path)?;
    let managed = load_manifest(app);
    Ok(detect(&mut archive, &p)?
        .into_iter()
        .map(|d| {
            let exists = content_dir(&ac, d.kind).join(&d.id).exists();
            let is_managed = managed.iter().any(|m| m.kind == d.kind && m.id == d.id);
            ModInfo { kind: d.kind.into(), id: d.id, exists, managed: is_managed }
        })
        .collect())
}

fn install(app: &AppHandle, path: &str, overwrite: bool) -> Result<Vec<ModInfo>, String> {
    let ac = crate::config::require_ac(app)?;
    let (mut archive, p) = open_zip(path)?;
    let detected = detect(&mut archive, &p)?;
    let mut manifest = load_manifest(app);

    for d in &detected {
        let dest = content_dir(&ac, d.kind).join(&d.id);
        if dest.exists() && !overwrite {
            return Err(format!("« {} » est déjà installé : confirme le remplacement pour continuer.", d.id));
        }
    }

    let mut results = vec![];
    for d in &detected {
        let dest = content_dir(&ac, d.kind).join(&d.id);
        let existed = dest.exists();
        for i in 0..archive.len() {
            let mut file = archive.by_index(i).map_err(|e| format!("Archive illisible : {e}"))?;
            let Some(path) = file.enclosed_name() else { continue };
            let comps = components(&path);
            if !comps.starts_with(&d.root) {
                continue;
            }
            let rel: PathBuf = comps[d.root.len()..].iter().collect();
            if rel.as_os_str().is_empty() {
                continue;
            }
            let out = dest.join(&rel);
            if file.is_dir() {
                fs::create_dir_all(&out).map_err(|e| e.to_string())?;
                continue;
            }
            if let Some(parent) = out.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut target = File::create(&out).map_err(|e| format!("Écriture de {} impossible : {e}", rel.display()))?;
            io::copy(&mut file, &mut target).map_err(|e| format!("Extraction de {} impossible : {e}", rel.display()))?;
        }
        let entry = InstalledMod { kind: d.kind.into(), id: d.id.clone() };
        // On ne s'approprie pas un contenu préexistant (jeu d'origine ou autre outil) : il reste non désinstallable.
        if !existed && !manifest.contains(&entry) {
            manifest.push(entry);
        }
        let managed = manifest.iter().any(|m| m.kind == d.kind && m.id == d.id);
        results.push(ModInfo { kind: d.kind.into(), id: d.id.clone(), exists: true, managed });
    }
    save_manifest(app, &manifest)?;
    Ok(results)
}

fn uninstall(app: &AppHandle, kind: &str, id: &str) -> Result<(), String> {
    let ac = crate::config::require_ac(app)?;
    let mut manifest = load_manifest(app);
    if !safe_id(id) || !manifest.iter().any(|m| m.kind == kind && m.id == id) {
        return Err("Seuls les mods installés par Nexora-Corsa peuvent être désinstallés ici.".into());
    }
    let dir = content_dir(&ac, kind).join(id);
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| format!("Suppression impossible : {e}"))?;
    }
    // Copie éventuellement faite pour le serveur dédié.
    let server_copy = ac.join("server").join("content").join(if kind == "car" { "cars" } else { "tracks" }).join(id);
    if server_copy.exists() {
        let _ = fs::remove_dir_all(server_copy);
    }
    manifest.retain(|m| !(m.kind == kind && m.id == id));
    save_manifest(app, &manifest)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn make_zip(name: &str, files: &[&str]) -> (ZipArchive<File>, PathBuf) {
        let path = std::env::temp_dir().join(name);
        let mut w = zip::ZipWriter::new(File::create(&path).unwrap());
        for f in files {
            w.start_file(*f, zip::write::SimpleFileOptions::default()).unwrap();
            w.write_all(b"{}").unwrap();
        }
        w.finish().unwrap();
        (ZipArchive::new(File::open(&path).unwrap()).unwrap(), path)
    }

    #[test]
    fn detects_prefixed_and_bare_mods() {
        let (mut a, p) = make_zip(
            "nexora_test_a.zip",
            &["content/cars/my_car/ui/ui_car.json", "content/cars/my_car/data.acd", "my_track/ui/ui_track.json"],
        );
        let d = detect(&mut a, &p).unwrap();
        assert_eq!(d.len(), 2);
        assert!(d.iter().any(|m| m.kind == "car" && m.id == "my_car"));
        assert!(d.iter().any(|m| m.kind == "track" && m.id == "my_track"));
    }

    #[test]
    fn bare_archive_uses_file_name_and_layouts_work() {
        let (mut a, p) = make_zip("nexora_bare.zip", &["ui/layout_a/ui_track.json", "models.ini"]);
        let d = detect(&mut a, &p).unwrap();
        assert_eq!(d.len(), 1);
        assert_eq!((d[0].kind, d[0].id.as_str()), ("track", "nexora_bare"));
        assert!(d[0].root.is_empty());
    }

    #[test]
    fn rejects_unrelated_archives() {
        let (mut a, p) = make_zip("nexora_none.zip", &["readme.txt"]);
        assert!(detect(&mut a, &p).is_err());
    }
}

#[tauri::command]
pub async fn inspect_mod(app: AppHandle, path: String) -> Result<Vec<ModInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || inspect(&app, &path)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn install_mod(app: AppHandle, path: String, overwrite: bool) -> Result<Vec<ModInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || install(&app, &path, overwrite))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn list_mods(app: AppHandle) -> Vec<InstalledMod> {
    load_manifest(&app)
}

#[tauri::command]
pub async fn uninstall_mod(app: AppHandle, kind: String, id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || uninstall(&app, &kind, &id))
        .await
        .map_err(|e| e.to_string())?
}
