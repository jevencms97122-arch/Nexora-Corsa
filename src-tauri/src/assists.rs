use serde::Serialize;
use std::fs;
use std::path::Path;
use tauri::AppHandle;

/// Profil choisi tant que l'utilisateur n'a rien changé (celui du lanceur d'origine d'Assetto Corsa).
pub const DEFAULT: &str = "gamer";

/// Réglages d'aide à la conduite, avec les codes d'`assists.ini` :
/// `abs` / `traction_control` : 0 = désactivé, 1 = d'origine (« Factory »), 2 = activé.
#[derive(Serialize, Clone, Copy)]
pub struct Assists {
    pub ideal_line: bool,
    pub auto_shifter: bool,
    pub auto_clutch: bool,
    pub auto_blip: bool,
    pub abs: u8,
    pub traction_control: u8,
    /// Pourcentage, 0 à 100.
    pub stability_control: u8,
    /// Multiplicateur de consommation : 0 = pas de consommation, 1 = réaliste.
    pub fuel_rate: u8,
    pub tyre_wear: u8,
}

#[derive(Serialize)]
pub struct Preset {
    pub id: &'static str,
    pub name: &'static str,
    pub tagline: &'static str,
    #[serde(flatten)]
    pub assists: Assists,
}

/// Valeurs relevées sur les profils du lanceur d'Assetto Corsa.
static PRESETS: [Preset; 3] = [
    Preset {
        id: "gamer",
        name: "Gamer",
        tagline: "Toutes les aides : idéal pour commencer",
        assists: Assists {
            ideal_line: true,
            auto_shifter: true,
            auto_clutch: true,
            auto_blip: true,
            abs: 2,
            traction_control: 2,
            stability_control: 100,
            fuel_rate: 0,
            tyre_wear: 1,
        },
    },
    Preset {
        id: "intermediate",
        name: "Intermédiaire",
        tagline: "Boîte manuelle, quelques aides",
        assists: Assists {
            ideal_line: false,
            auto_shifter: false,
            auto_clutch: true,
            auto_blip: true,
            abs: 2,
            traction_control: 1,
            stability_control: 50,
            fuel_rate: 0,
            tyre_wear: 1,
        },
    },
    Preset {
        id: "pro",
        name: "Pro",
        tagline: "Aucune aide : conduite réaliste",
        assists: Assists {
            ideal_line: false,
            auto_shifter: false,
            auto_clutch: false,
            auto_blip: false,
            abs: 1,
            traction_control: 1,
            stability_control: 0,
            fuel_rate: 1,
            tyre_wear: 1,
        },
    },
];

pub fn preset(id: &str) -> Option<&'static Preset> {
    PRESETS.iter().find(|p| p.id == id)
}

fn flag(b: bool) -> String {
    u8::from(b).to_string()
}

/// Les clés d'`assists.ini` pilotées par un profil. Les autres (dégâts, chauffe-pneus, aspiration…) ne sont pas touchées.
fn ini_values(a: &Assists) -> Vec<(&'static str, String)> {
    vec![
        ("IDEAL_LINE", flag(a.ideal_line)),
        ("AUTO_SHIFTER", flag(a.auto_shifter)),
        ("AUTO_CLUTCH", flag(a.auto_clutch)),
        ("AUTO_BLIP", flag(a.auto_blip)),
        ("ABS", a.abs.to_string()),
        ("TRACTION_CONTROL", a.traction_control.to_string()),
        ("STABILITY_CONTROL", a.stability_control.to_string()),
        ("FUEL_RATE", a.fuel_rate.to_string()),
        ("TYRE_WEAR", a.tyre_wear.to_string()),
    ]
}

/// Met à jour (ou ajoute) les clés données dans la section `[ASSISTS]`, sans toucher au reste du fichier.
pub fn merge(existing: &str, updates: &[(&str, String)]) -> String {
    let mut out: Vec<String> = vec![];
    let mut done = vec![false; updates.len()];
    let mut in_assists = false;
    let mut section_seen = false;
    // Position d'insertion des clés manquantes : juste après la dernière ligne de la section.
    let mut insert_at = 0;

    for line in existing.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            in_assists = trimmed.eq_ignore_ascii_case("[ASSISTS]");
            section_seen |= in_assists;
        }
        if in_assists && !trimmed.starts_with('[') {
            if let Some((key, _)) = trimmed.split_once('=') {
                if let Some(i) = updates.iter().position(|(k, _)| k.eq_ignore_ascii_case(key.trim())) {
                    out.push(format!("{}={}", updates[i].0, updates[i].1));
                    done[i] = true;
                    insert_at = out.len();
                    continue;
                }
            }
        }
        out.push(line.to_string());
        if in_assists && !trimmed.is_empty() {
            insert_at = out.len();
        } else if in_assists && trimmed.starts_with('[') {
            insert_at = out.len();
        }
    }

    let missing: Vec<String> = updates
        .iter()
        .zip(&done)
        .filter(|(_, d)| !**d)
        .map(|((k, v), _)| format!("{k}={v}"))
        .collect();
    if !missing.is_empty() {
        if section_seen {
            out.splice(insert_at..insert_at, missing);
        } else {
            if out.last().is_some_and(|l| !l.is_empty()) {
                out.push(String::new());
            }
            out.push("[ASSISTS]".into());
            out.extend(missing);
        }
    }
    let mut text = out.join("\r\n");
    text.push_str("\r\n");
    text
}

/// Écrit le profil dans `assists.ini` (lu par le jeu au lancement). L'original est sauvegardé une seule fois.
pub fn apply(cfg_dir: &Path, id: &str) -> Result<(), String> {
    let preset = preset(id).ok_or_else(|| format!("Profil d'aides inconnu : {id}"))?;
    let file = cfg_dir.join("assists.ini");
    let existing = fs::read_to_string(&file).unwrap_or_default();
    let backup = cfg_dir.join("assists.ini.nexora.bak");
    if file.is_file() && !backup.exists() {
        let _ = fs::copy(&file, &backup);
    }
    fs::write(&file, merge(&existing, &ini_values(&preset.assists)))
        .map_err(|e| format!("Écriture de assists.ini impossible : {e}"))
}

/// Applique le profil choisi dans les paramètres (ou le profil par défaut).
pub fn apply_selected(app: &AppHandle, cfg_dir: &Path) -> Result<(), String> {
    let cfg = crate::config::load(app);
    let id = if preset(&cfg.assists).is_some() { cfg.assists.as_str() } else { DEFAULT };
    apply(cfg_dir, id)
}

#[tauri::command]
pub fn assist_presets() -> &'static [Preset] {
    &PRESETS
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Contenu réel de `assists.ini` pour le profil Gamer (relevé sur une installation).
    const GAMER_FILE: &str = "[ASSISTS]\r\nIDEAL_LINE=1\r\nAUTO_BLIP=1\r\nSTABILITY_CONTROL=100\r\nAUTO_BRAKE=0\r\nAUTO_SHIFTER=1\r\nABS=2\r\nTRACTION_CONTROL=2\r\nAUTO_CLUTCH=1\r\nVISUALDAMAGE=0\r\nDAMAGE=0\r\nFUEL_RATE=0\r\nTYRE_WEAR=1\r\nTYRE_BLANKETS=1\r\nSLIPSTREAM=1\r\n";

    fn value(text: &str, key: &str) -> Option<String> {
        text.lines().find_map(|l| l.strip_prefix(&format!("{key}=")).map(str::to_string))
    }

    #[test]
    fn gamer_profile_matches_the_real_gamer_file() {
        let merged = merge(GAMER_FILE, &ini_values(&preset("gamer").unwrap().assists));
        for key in ["IDEAL_LINE", "AUTO_BLIP", "STABILITY_CONTROL", "AUTO_SHIFTER", "ABS", "TRACTION_CONTROL", "AUTO_CLUTCH", "FUEL_RATE", "TYRE_WEAR"] {
            assert_eq!(value(&merged, key), value(GAMER_FILE, key), "{key}");
        }
    }

    #[test]
    fn pro_profile_changes_only_its_keys() {
        let merged = merge(GAMER_FILE, &ini_values(&preset("pro").unwrap().assists));
        assert_eq!(value(&merged, "ABS").as_deref(), Some("1"));
        assert_eq!(value(&merged, "STABILITY_CONTROL").as_deref(), Some("0"));
        assert_eq!(value(&merged, "FUEL_RATE").as_deref(), Some("1"));
        assert_eq!(value(&merged, "AUTO_SHIFTER").as_deref(), Some("0"));
        // clés hors profil : conservées, dans le même ordre
        for key in ["AUTO_BRAKE", "VISUALDAMAGE", "DAMAGE", "TYRE_BLANKETS", "SLIPSTREAM"] {
            assert_eq!(value(&merged, key), value(GAMER_FILE, key), "{key}");
        }
        assert_eq!(merged.lines().count(), GAMER_FILE.lines().count());
    }

    #[test]
    fn creates_the_file_or_section_when_missing() {
        let updates = ini_values(&preset("intermediate").unwrap().assists);
        let fresh = merge("", &updates);
        assert!(fresh.starts_with("[ASSISTS]") && value(&fresh, "TRACTION_CONTROL").as_deref() == Some("1"));
        let other = merge("[OTHER]\r\nX=1\r\n", &updates);
        assert!(other.contains("[OTHER]") && other.contains("[ASSISTS]") && value(&other, "STABILITY_CONTROL").as_deref() == Some("50"));
        // clés manquantes ajoutées dans la section existante, avant la section suivante
        let partial = merge("[ASSISTS]\r\nIDEAL_LINE=1\r\n\r\n[OTHER]\r\nX=1\r\n", &updates);
        assert!(partial.find("ABS=").unwrap() < partial.find("[OTHER]").unwrap());
    }

    #[test]
    fn apply_writes_the_file_and_keeps_the_first_backup() {
        let dir = std::env::temp_dir().join("nexora_assists_test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("assists.ini"), GAMER_FILE).unwrap();
        apply(&dir, "pro").unwrap();
        apply(&dir, "intermediate").unwrap();
        let now = fs::read_to_string(dir.join("assists.ini")).unwrap();
        assert_eq!(value(&now, "ABS").as_deref(), Some("2"));
        assert_eq!(value(&now, "AUTO_SHIFTER").as_deref(), Some("0"));
        // la sauvegarde est celle de l'original (Gamer), pas du premier profil appliqué
        assert_eq!(fs::read_to_string(dir.join("assists.ini.nexora.bak")).unwrap(), GAMER_FILE);
        assert!(apply(&dir, "inconnu").is_err());
        let _ = fs::remove_dir_all(&dir);
    }
}
