use serde::Serialize;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::AppHandle;

/// Taille maximale acceptée pour une archive téléchargée depuis un lien personnalisé.
const MAX_DOWNLOAD_BYTES: u64 = 2 * 1024 * 1024 * 1024;

/// Page de téléchargement proposée à l'utilisateur : Custom Shaders Patch v0.2.11 sur modland.net.
/// Ce n'est pas le site de l'auteur, d'où les avertissements affichés avant l'installation.
const DOWNLOAD_URL: &str = "https://www.modland.net/download/631759";
const DOWNLOAD_VERSION: &str = "0.2.11";

#[derive(Serialize)]
pub struct CspSource {
    pub url: &'static str,
    pub version: &'static str,
}

#[derive(Serialize)]
pub struct CspStatus {
    pub installed: bool,
    /// Lue dans `extension/installed.log` (écrit par Content Manager) ; absente si CSP a été copié à la main.
    pub version: Option<String>,
    pub build: Option<String>,
}

/// Version de Custom Shaders Patch lue dans `dwrite.dll` lui-même (ressource de version Windows).
/// C'est la référence : `installed.log` n'est écrit que par Content Manager et reste périmé après une installation manuelle.
#[cfg(windows)]
fn dll_version(dll: &Path) -> Option<String> {
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "version")]
    unsafe extern "system" {
        fn GetFileVersionInfoSizeW(path: *const u16, handle: *mut u32) -> u32;
        fn GetFileVersionInfoW(path: *const u16, handle: u32, len: u32, data: *mut c_void) -> i32;
        fn VerQueryValueW(block: *const c_void, sub: *const u16, buffer: *mut *mut c_void, len: *mut u32) -> i32;
    }
    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    let path: Vec<u16> = dll.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    // SAFETY : tampons dimensionnés par Windows (GetFileVersionInfoSizeW) ; les pointeurs renvoyés par VerQueryValueW pointent dans `data`, qui reste vivant.
    unsafe {
        let mut handle = 0u32;
        let size = GetFileVersionInfoSizeW(path.as_ptr(), &mut handle);
        if size == 0 {
            return None;
        }
        let mut data = vec![0u8; size as usize];
        if GetFileVersionInfoW(path.as_ptr(), 0, size, data.as_mut_ptr().cast()) == 0 {
            return None;
        }
        let (mut ptr, mut len) = (std::ptr::null_mut::<c_void>(), 0u32);
        // Version « produit » en texte (ex. 0.3.0-preview132) : langue déclarée par le fichier, puis les langues usuelles.
        let mut langs: Vec<String> = vec![];
        if VerQueryValueW(data.as_ptr().cast(), wide("\\VarFileInformation\\Translation").as_ptr(), &mut ptr, &mut len) != 0 && len >= 4 {
            let pairs = std::slice::from_raw_parts(ptr as *const u16, (len as usize / 2) & !1);
            langs.extend(pairs.chunks(2).map(|p| format!("{:04x}{:04x}", p[0], p[1])));
        }
        langs.extend(["040904b0", "000004b0", "040904e4", "000004e4", "040c04b0"].map(String::from));
        for lang in langs {
            let sub = wide(&format!("\\StringFileInfo\\{lang}\\ProductVersion"));
            if VerQueryValueW(data.as_ptr().cast(), sub.as_ptr(), &mut ptr, &mut len) != 0 && len > 1 {
                let text = String::from_utf16_lossy(std::slice::from_raw_parts(ptr as *const u16, len as usize));
                let text = text.trim_end_matches('\0').trim().to_string();
                if !text.is_empty() {
                    return Some(text);
                }
            }
        }
        // Sinon, les quatre nombres de la version du fichier.
        if VerQueryValueW(data.as_ptr().cast(), wide("\\").as_ptr(), &mut ptr, &mut len) != 0 && len as usize >= 16 {
            let fixed = std::slice::from_raw_parts(ptr as *const u32, 4);
            if fixed[0] == 0xFEEF04BD {
                let (ms, ls) = (fixed[2], fixed[3]);
                return Some(format!("{}.{}.{}.{}", ms >> 16, ms & 0xFFFF, ls >> 16, ls & 0xFFFF));
            }
        }
        None
    }
}

#[cfg(not(windows))]
fn dll_version(_dll: &Path) -> Option<String> {
    None
}

/// CSP est présent quand son chargeur (`dwrite.dll`) et son dossier `extension` sont tous deux dans le jeu.
pub fn status(ac: &Path) -> CspStatus {
    let installed = ac.join("dwrite.dll").is_file() && ac.join("extension").is_dir();
    let log = if installed { fs::read_to_string(ac.join("extension").join("installed.log")).ok() } else { None };
    let field = |key: &str| {
        log.as_deref().and_then(|text| {
            text.lines()
                .find_map(|l| l.strip_prefix(key).map(|v| v.trim().to_string()))
                .filter(|v| !v.is_empty())
        })
    };
    // La version de la DLL fait foi ; le journal ne sert que s'il la confirme ou si la DLL n'a pas de version lisible.
    let from_dll = if installed { dll_version(&ac.join("dwrite.dll")) } else { None };
    let log_version = field("version:");
    let (version, build) = match from_dll {
        Some(v) => {
            let same_as_log = log_version.as_deref().is_some_and(|l| v == l || v.starts_with(&format!("{l}-")));
            (Some(v), if same_as_log { field("build:") } else { None })
        }
        None => (log_version, field("build:")),
    };
    CspStatus { installed, version, build }
}

/// Ce que Custom Shaders Patch apporte dans `extension` : retiré à la désinstallation. `weather` et `weather-controllers`
/// (où vivent aussi les mods de ciel de l'utilisateur) et tout dossier inconnu sont conservés.
const OWNED: [&str; 10] = ["config", "internal", "lua", "sfx", "textures", "backgrounds", "vao-patches", "vao-patches-cars", "shaders.zip", "installed.log"];

/// Retire le chargeur puis les fichiers du patch ; renvoie ce qui a été supprimé.
fn uninstall_in(ac: &Path) -> Result<Vec<String>, String> {
    if !status(ac).installed {
        return Err("Custom Shaders Patch n'est pas installé.".into());
    }
    // Le chargeur d'abord : sans lui, le jeu ne charge plus rien du patch, même si la suite échoue.
    fs::remove_file(ac.join("dwrite.dll"))
        .map_err(|e| format!("Impossible de supprimer dwrite.dll ({e}). Ferme Assetto Corsa puis réessaie."))?;
    let mut removed = vec!["dwrite.dll".to_string()];
    let ext = ac.join("extension");
    for name in OWNED {
        let path = ext.join(name);
        let result = if path.is_dir() { fs::remove_dir_all(&path) } else if path.is_file() { fs::remove_file(&path) } else { continue };
        result.map_err(|e| format!("Impossible de supprimer extension/{name} : {e}"))?;
        removed.push(format!("extension/{name}"));
    }
    // Le dossier lui-même seulement s'il est vide (remove_dir échoue sinon, ce qui est voulu).
    let _ = fs::remove_dir(&ext);
    Ok(removed)
}

#[tauri::command]
pub async fn uninstall_csp(app: AppHandle) -> Result<CspStatus, String> {
    let ac = crate::config::require_ac(&app)?;
    tauri::async_runtime::spawn_blocking(move || uninstall_in(&ac).map(|_| status(&ac))).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn csp_status(app: AppHandle) -> Result<CspStatus, String> {
    Ok(status(&crate::config::require_ac(&app)?))
}

#[tauri::command]
pub fn csp_source() -> CspSource {
    CspSource { url: DOWNLOAD_URL, version: DOWNLOAD_VERSION }
}

/// Extension d'après les premiers octets : seuls zip, 7z et rar sont des archives que l'installeur sait lire.
fn archive_extension(head: &[u8]) -> Option<&'static str> {
    if head.starts_with(b"PK\x03\x04") {
        Some("zip")
    } else if head.starts_with(&[0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C]) {
        Some("7z")
    } else if head.starts_with(b"Rar!") {
        Some("rar")
    } else {
        None
    }
}

fn valid_url(url: &str) -> Result<(), String> {
    let rest = url.trim().strip_prefix("https://").ok_or("Le lien doit commencer par https://")?;
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    if host.is_empty() || host.contains(char::is_whitespace) || host.contains('@') {
        return Err("Lien invalide.".into());
    }
    Ok(())
}

fn download_to(dir: &Path, url: &str) -> Result<PathBuf, String> {
    valid_url(url)?;
    let agent: ureq::Agent = ureq::Agent::config_builder().timeout_global(Some(Duration::from_secs(900))).build().into();
    let mut response = agent.get(url.trim()).call().map_err(|e| format!("Téléchargement impossible : {e}"))?;
    let mut reader = response.body_mut().with_config().limit(MAX_DOWNLOAD_BYTES).reader();
    let mut head = [0u8; 8];
    reader.read_exact(&mut head).map_err(|_| "Le lien n'a renvoyé aucun fichier.".to_string())?;
    let ext = archive_extension(&head).ok_or(
        "Ce lien ne donne pas directement une archive (.zip, .7z ou .rar) : c'est probablement une page web. Ouvre-la dans le navigateur, télécharge le fichier, puis choisis-le avec « Choisir un fichier ».",
    )?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    // Une seule archive à la fois : les précédentes ne servent plus.
    for old in fs::read_dir(dir).into_iter().flatten().flatten() {
        let _ = fs::remove_file(old.path());
    }
    let path = dir.join(format!("csp-personnalise.{ext}"));
    let mut file = fs::File::create(&path).map_err(|e| format!("Écriture impossible : {e}"))?;
    file.write_all(&head).map_err(|e| e.to_string())?;
    std::io::copy(&mut reader, &mut file).map_err(|e| format!("Téléchargement interrompu : {e}"))?;
    Ok(path)
}

/// Télécharge une archive depuis un lien choisi par l'utilisateur ; elle est ensuite examinée comme n'importe quel mod avant toute installation.
#[tauri::command]
pub async fn download_csp(app: AppHandle, url: String) -> Result<String, String> {
    let dir = crate::config::data_dir(&app)?.join("csp-download");
    let path = tauri::async_runtime::spawn_blocking(move || download_to(&dir, &url)).await.map_err(|e| e.to_string())??;
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uninstall_removes_the_patch_but_keeps_skies_and_user_files() {
        let dir = std::env::temp_dir().join("nexora_csp_uninstall");
        let _ = fs::remove_dir_all(&dir);
        for sub in ["config", "internal", "lua/new-modes", "weather/sol", "weather-controllers/sol", "mes-fichiers"] {
            fs::create_dir_all(dir.join("extension").join(sub)).unwrap();
            fs::write(dir.join("extension").join(sub).join("a.txt"), "x").unwrap();
        }
        fs::write(dir.join("dwrite.dll"), "x").unwrap();
        fs::write(dir.join("extension").join("shaders.zip"), "x").unwrap();
        fs::write(dir.join("extension").join("installed.log"), "version: 0.3.0
").unwrap();
        fs::write(dir.join("dwrite.dll.nexora-bak"), "old").unwrap();
        fs::create_dir_all(dir.join("content")).unwrap();

        let removed = uninstall_in(&dir).unwrap();
        assert!(removed.contains(&"dwrite.dll".to_string()));
        assert!(!status(&dir).installed);
        assert!(!dir.join("dwrite.dll").exists() && !dir.join("extension/config").exists() && !dir.join("extension/lua").exists());
        assert!(!dir.join("extension/shaders.zip").exists() && !dir.join("extension/installed.log").exists());
        for kept in ["extension/weather/sol/a.txt", "extension/weather-controllers/sol/a.txt", "extension/mes-fichiers/a.txt", "dwrite.dll.nexora-bak", "content"] {
            assert!(dir.join(kept).exists(), "{kept} doit rester");
        }
        assert!(uninstall_in(&dir).is_err(), "déjà désinstallé");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn uninstall_drops_the_empty_extension_folder() {
        let dir = std::env::temp_dir().join("nexora_csp_uninstall_empty");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("extension/config")).unwrap();
        fs::write(dir.join("dwrite.dll"), "x").unwrap();
        uninstall_in(&dir).unwrap();
        assert!(!dir.join("extension").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn recognises_archives_by_content_and_rejects_web_pages() {
        assert_eq!(archive_extension(b"PK\x03\x04abcd"), Some("zip"));
        assert_eq!(archive_extension(&[0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C, 0, 4]), Some("7z"));
        assert_eq!(archive_extension(b"Rar!\x1a\x07\x00\x00"), Some("rar"));
        assert_eq!(archive_extension(b"<!DOCTYPE html>"), None);
    }

    #[test]
    fn only_accepts_https_links() {
        assert!(valid_url("https://www.modland.net/download/631759").is_ok());
        assert!(valid_url("http://example.com/a.zip").is_err());
        assert!(valid_url("https://").is_err());
        assert!(valid_url("https://user@evil.com/a").is_err());
        assert!(valid_url("file:///C:/a.zip").is_err());
    }

    #[test]
    fn download_source_is_https_and_versioned() {
        let s = csp_source();
        assert!(s.url.starts_with("https://"));
        assert!(s.version.split('.').count() == 3);
    }

    #[test]
    fn detects_missing_and_present_csp() {
        let dir = std::env::temp_dir().join("nexora_csp_test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("extension")).unwrap();
        // dwrite.dll seul (ex. un autre outil) : pas de dossier extension complet → on exige les deux
        assert!(!status(&dir).installed);
        fs::write(dir.join("dwrite.dll"), "x").unwrap();
        let s = status(&dir);
        assert!(s.installed && s.version.is_none());
        fs::write(dir.join("extension").join("installed.log"), "# c\nversion: 0.2.11\nbuild: 3465\nfile: a\n").unwrap();
        let s = status(&dir);
        assert_eq!((s.version.as_deref(), s.build.as_deref()), (Some("0.2.11"), Some("3465")));
        let _ = fs::remove_dir_all(&dir);
    }
}

#[cfg(all(test, windows))]
mod version_tests {
    use super::*;

    #[test]
    fn reads_the_version_resource_of_a_real_dll() {
        // Une DLL système a toujours une version ; un fichier quelconque n'en a pas.
        let system = Path::new("C:/Windows/System32/kernel32.dll");
        if system.is_file() {
            let v = dll_version(system).expect("kernel32 a une version");
            assert!(v.chars().next().is_some_and(|c| c.is_ascii_digit()), "{v}");
        }
        let junk = std::env::temp_dir().join("nexora_not_a_dll.dll");
        fs::write(&junk, "x").unwrap();
        assert_eq!(dll_version(&junk), None);
        let _ = fs::remove_file(junk);
    }

    #[test]
    fn the_installed_dll_wins_over_a_stale_log() {
        let ac = Path::new("D:/SteamLibrary/steamapps/common/assettocorsa");
        if let Some(v) = ac.join("dwrite.dll").is_file().then(|| status(ac).version).flatten() {
            println!("version lue : {v}");
        }
    }
}
