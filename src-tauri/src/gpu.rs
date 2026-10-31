//! Choix de la carte graphique utilisée par Assetto Corsa.
//!
//! Sur un portable, Windows lance souvent les jeux sur la puce intégrée. Le réglage « Haute performance » de
//! Windows (Paramètres → Affichage → Graphismes) est stocké par programme dans le registre de l'utilisateur ;
//! on l'écrit exactement comme le fait cette page de Windows.

use serde::Serialize;
use std::path::Path;
use tauri::AppHandle;

/// Programmes d'Assetto Corsa concernés (ceux qui existent dans le dossier du jeu).
const EXES: [&str; 3] = ["acs.exe", "AssettoCorsa.exe", "acs_x86.exe"];
#[cfg(windows)]
const PREFERENCES_KEY: &str = "Software\\Microsoft\\DirectX\\UserGpuPreferences";
#[cfg(windows)]
const ADAPTERS_KEY: &str = "SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}";
const HIGH_PERFORMANCE: &str = "GpuPreference=2;";

#[derive(Serialize)]
pub struct GpuInfo {
    adapters: Vec<String>,
    has_discrete: bool,
    has_integrated: bool,
    /// Assetto Corsa est réglé sur « Haute performance » dans Windows.
    forced: bool,
}

#[derive(PartialEq, Debug)]
enum Kind {
    Discrete,
    Integrated,
}

/// Carte dédiée (NVIDIA, AMD Radeon RX/Pro, Intel Arc) ou puce intégrée (Intel UHD/Iris, Radeon Graphics).
fn kind(name: &str) -> Kind {
    let n = name.to_lowercase();
    let discrete = n.contains("nvidia")
        || n.contains("geforce")
        || n.contains("quadro")
        || n.contains("radeon rx")
        || n.contains("radeon pro")
        || n.contains("arc(tm)")
        || n.contains(" arc ");
    if discrete { Kind::Discrete } else { Kind::Integrated }
}

fn is_high_performance(value: &str) -> bool {
    value.split(';').any(|part| part.trim().eq_ignore_ascii_case("GpuPreference=2"))
}

#[cfg(windows)]
fn adapters() -> Vec<String> {
    use winreg::RegKey;
    use winreg::enums::HKEY_LOCAL_MACHINE;
    let Ok(class) = RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(ADAPTERS_KEY) else { return vec![] };
    let mut names: Vec<String> = vec![];
    for sub in class.enum_keys().flatten().filter(|k| k.len() == 4 && k.chars().all(|c| c.is_ascii_digit())) {
        if let Ok(desc) = class.open_subkey(&sub).and_then(|k| k.get_value::<String, _>("DriverDesc")) {
            if !desc.trim().is_empty() && !names.contains(&desc) {
                names.push(desc);
            }
        }
    }
    names
}

#[cfg(not(windows))]
fn adapters() -> Vec<String> {
    vec![]
}

#[cfg(windows)]
fn forced(ac: &Path) -> bool {
    use winreg::RegKey;
    use winreg::enums::HKEY_CURRENT_USER;
    let Ok(key) = RegKey::predef(HKEY_CURRENT_USER).open_subkey(PREFERENCES_KEY) else { return false };
    key.get_value::<String, _>(ac.join("acs.exe").to_string_lossy().as_ref()).is_ok_and(|v| is_high_performance(&v))
}

#[cfg(not(windows))]
fn forced(_ac: &Path) -> bool {
    false
}

fn info(ac: &Path) -> GpuInfo {
    let adapters = adapters();
    GpuInfo {
        has_discrete: adapters.iter().any(|a| kind(a) == Kind::Discrete),
        has_integrated: adapters.iter().any(|a| kind(a) == Kind::Integrated),
        forced: forced(ac),
        adapters,
    }
}

#[cfg(windows)]
fn write_preference(ac: &Path, high: bool) -> Result<(), String> {
    use winreg::RegKey;
    use winreg::enums::HKEY_CURRENT_USER;
    let (key, _) = RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey(PREFERENCES_KEY)
        .map_err(|e| format!("Accès au registre impossible : {e}"))?;
    for exe in EXES {
        let path = ac.join(exe);
        if !path.is_file() {
            continue;
        }
        let name = path.to_string_lossy().into_owned();
        if high {
            key.set_value(&name, &HIGH_PERFORMANCE).map_err(|e| format!("Écriture dans le registre impossible : {e}"))?;
        } else if key.get_value::<String, _>(&name).is_ok() {
            // On ne retire que ce qui existait : le réglage par défaut de Windows revient.
            key.delete_value(&name).map_err(|e| format!("Suppression dans le registre impossible : {e}"))?;
        }
    }
    Ok(())
}

#[cfg(not(windows))]
fn write_preference(_ac: &Path, _high: bool) -> Result<(), String> {
    Err("Réglage disponible uniquement sous Windows.".into())
}

#[tauri::command]
pub fn gpu_info(app: AppHandle) -> Result<GpuInfo, String> {
    Ok(info(&crate::config::require_ac(&app)?))
}

#[tauri::command]
pub fn set_gpu_preference(app: AppHandle, high: bool) -> Result<GpuInfo, String> {
    let ac = crate::config::require_ac(&app)?;
    write_preference(&ac, high)?;
    Ok(info(&ac))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tells_discrete_cards_from_integrated_chips() {
        assert_eq!(kind("NVIDIA GeForce RTX 5060 Laptop GPU"), Kind::Discrete);
        assert_eq!(kind("AMD Radeon RX 7800 XT"), Kind::Discrete);
        assert_eq!(kind("Intel(R) Arc(TM) A770 Graphics"), Kind::Discrete);
        assert_eq!(kind("Intel(R) Iris(R) Xe Graphics"), Kind::Integrated);
        assert_eq!(kind("Intel(R) UHD Graphics 630"), Kind::Integrated);
        assert_eq!(kind("AMD Radeon(TM) Graphics"), Kind::Integrated);
    }

    #[test]
    fn reads_the_windows_preference_value() {
        assert!(is_high_performance("GpuPreference=2;"));
        assert!(is_high_performance("SwapEffectUpgradeEnable=1;GpuPreference=2;"));
        assert!(!is_high_performance("GpuPreference=1;"));
        assert!(!is_high_performance(""));
    }

    #[test]
    fn this_machine_reports_its_adapters() {
        // Sur Windows, au moins une carte graphique doit être listée.
        #[cfg(windows)]
        assert!(!adapters().is_empty());
    }
}
