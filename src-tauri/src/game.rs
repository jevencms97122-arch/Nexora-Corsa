use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

/// Contenu officiel (jeu de base et DLC) : identifiant de voiture → code du pack DLC (absent = jeu de base).
struct Official {
    cars: HashMap<String, Option<String>>,
    /// Code du pack (« D1 », « RP »…) → nom affiché (« Dream Pack 1 », « Red Pack »…).
    packs: HashMap<String, String>,
}

/// Lit `[CARS]` (« id=1 » ou « id=1, CODE ») et les noms des sections `[DLC_CODE]`.
fn parse_official(text: &str) -> Official {
    let mut official = Official { cars: HashMap::new(), packs: HashMap::new() };
    let mut section = String::new();
    for line in text.lines() {
        let line = line.split(';').next().unwrap_or("").trim();
        if let Some(name) = line.strip_prefix('[').and_then(|l| l.strip_suffix(']')) {
            section = name.to_string();
        } else if section == "CARS" {
            if let Some((id, value)) = line.split_once('=') {
                let pack = value.split(',').nth(1).map(str::trim).filter(|p| !p.is_empty());
                official.cars.insert(id.trim().to_lowercase(), pack.map(str::to_string));
            }
        } else if let Some(code) = section.strip_prefix("DLC_") {
            if let Some(name) = line.strip_prefix("NAME=") {
                official.packs.insert(code.to_string(), name.trim().to_string());
            }
        }
    }
    official
}

/// Source de vérité : la liste du Custom Shaders Patch installé dans le jeu (à jour avec les DLC),
/// sinon la copie de secours intégrée à Nexora-Corsa.
fn load_official(ac: &Path) -> Official {
    let installed = read_text(&ac.join("extension").join("config").join("data_standard_content.ini"));
    let parsed = installed.as_deref().map(parse_official).filter(|o| !o.cars.is_empty());
    parsed.unwrap_or_else(|| parse_official(include_str!("official_cars.ini")))
}

#[derive(Serialize)]
pub struct Car {
    pub id: String,
    pub name: String,
    pub brand: String,
    /// "base" (jeu de base), "dlc" (pack officiel) ou "mod".
    pub origin: String,
    /// Nom du pack quand `origin` vaut "dlc".
    pub pack: String,
    /// "street", "race"… tel qu'indiqué par le mod (peut être vide).
    pub class: String,
    pub bhp: String,
    pub weight: String,
    pub top_speed: String,
    pub skins: Vec<String>,
}

#[derive(Serialize)]
pub struct TrackLayout {
    pub id: String,
    /// Nom complet, ex. « Shutoko Revival Project 0.9.3 - Daishi PA ».
    pub name: String,
    /// Nom sans la partie commune à toutes les configurations du circuit, ex. « Daishi PA ».
    pub label: String,
    pub country: String,
    /// Longueur en mètres, telle qu'écrite dans le mod (souvent "4909" ou "4.9 km").
    pub length: String,
    pub pitboxes: String,
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

/// Décalage entre l'identifiant de compte Steam (32 bits) et le SteamID64.
const STEAM_ID64_BASE: u64 = 76_561_197_960_265_728;

/// Compte actuellement connecté dans le client Steam (0 si personne).
fn active_steam_user() -> Option<String> {
    #[cfg(windows)]
    {
        use winreg::RegKey;
        use winreg::enums::HKEY_CURRENT_USER;
        let key = RegKey::predef(HKEY_CURRENT_USER).open_subkey("Software\\Valve\\Steam\\ActiveProcess").ok()?;
        let account: u32 = key.get_value("ActiveUser").ok()?;
        return (account != 0).then(|| (STEAM_ID64_BASE + u64::from(account)).to_string());
    }
    #[cfg(not(windows))]
    None
}

/// Comptes listés dans `loginusers.vdf`, avec leur horodatage de dernière connexion
/// et l'éventuel drapeau `MostRecent` (absent des versions récentes de Steam).
fn login_users() -> Vec<(String, u64, bool)> {
    let Some(root) = steam_root() else { return vec![] };
    let Ok(text) = fs::read_to_string(root.join("config").join("loginusers.vdf")) else { return vec![] };
    let mut users: Vec<(String, u64, bool)> = vec![];
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.matches('"').count() == 2 {
            let id = trimmed.trim_matches('"');
            if id.len() >= 15 && id.chars().all(|c| c.is_ascii_digit()) {
                users.push((id.to_string(), 0, false));
            }
        } else if let (Some((k, v)), Some(last)) = (vdf_pair(trimmed), users.last_mut()) {
            match k.as_str() {
                "timestamp" => last.1 = v.parse().unwrap_or(0),
                "MostRecent" => last.2 = v == "1",
                _ => {}
            }
        }
    }
    users
}

/// SteamID64 du compte Steam connecté (nécessaire pour rejoindre un serveur).
/// Ordre : compte actif du client Steam, puis `MostRecent`, puis connexion la plus récente.
pub fn steam_id() -> Option<String> {
    if let Some(id) = active_steam_user() {
        return Some(id);
    }
    let users = login_users();
    users
        .iter()
        .find(|u| u.2)
        .or_else(|| users.iter().max_by_key(|u| u.1))
        .map(|u| u.0.clone())
}

#[cfg(test)]
mod tests {
    #[test]
    fn steam_id_is_found_on_this_machine() {
        // Nécessite Steam installé et connecté ; l'ID doit ressembler à un SteamID64.
        let id = super::steam_id().expect("compte Steam introuvable");
        println!("steam id = {id}");
        assert!(id.starts_with("7656119") && id.len() == 17);
    }

    #[test]
    fn derives_a_track_title_from_its_layouts() {
        let names = [
            "Shutoko Revival Project 0.9.3 - Daishi PA",
            "Shutoko Revival Project 0.9.3 - Heiwajima PA - Northbound",
            "Shutoko Revival Project 0.9.3 - Main Layout",
        ];
        let title = super::common_title(&names).unwrap();
        assert_eq!(title, "Shutoko Revival Project 0.9.3");
        assert_eq!(super::strip_title(names[0], &title), "Daishi PA");
        assert_eq!(super::strip_title(names[1], &title), "Heiwajima PA - Northbound");
        // sans début commun, ou une seule configuration : rien à déduire
        assert_eq!(super::common_title(&["Monza", "Imola"]), None);
        assert_eq!(super::common_title(&["Monza"]), None);
        // jamais de configuration vidée de son nom
        assert_eq!(super::common_title(&["Spa - GP", "Spa"]), None);
        assert_eq!(super::strip_title("Spa", "Spa"), "Spa");
    }

    #[test]
    fn parses_base_dlc_and_pack_names() {
        let o = super::parse_official(
            "; commentaire\n[CARS]\nabarth500=1\nks_bmw_m4=1, D2 ; note\nks_ferrari_312_67=1, FP\n\n[DLC_D2]\nNAME=Dream Pack 2\n[DLC_FP]\nNAME=Ferrari Pack\n",
        );
        assert_eq!(o.cars["abarth500"], None);
        assert_eq!(o.cars["ks_bmw_m4"].as_deref(), Some("D2"));
        assert_eq!(o.packs["D2"], "Dream Pack 2");
        assert!(!o.cars.contains_key("mon_mod"));
    }

    #[test]
    fn embedded_fallback_is_complete_and_has_no_secrets() {
        let text = include_str!("official_cars.ini");
        assert!(!text.contains("KEY="), "la copie de secours ne doit pas contenir de clés");
        let o = super::parse_official(text);
        assert!(o.cars.len() > 150, "{} voitures seulement", o.cars.len());
        assert_eq!(o.cars["bmw_m3_e30"], None);
        assert_eq!(o.cars["ks_bmw_m4"].as_deref(), Some("D2"));
        assert_eq!(o.packs.len(), 11);
        // chaque code de pack utilisé par une voiture a bien un nom
        for pack in o.cars.values().flatten() {
            assert!(o.packs.contains_key(pack), "pack sans nom : {pack}");
        }
    }
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

const TITLE_SEP: &str = " - ";

/// Partie initiale commune à tous les noms, découpée sur « - » (ex. « Shutoko Revival Project 0.9.3 »).
/// `None` s'il y a moins de deux noms ou aucun début commun exploitable.
fn common_title(names: &[&str]) -> Option<String> {
    if names.len() < 2 {
        return None;
    }
    let split: Vec<Vec<&str>> = names.iter().map(|n| n.split(TITLE_SEP).collect()).collect();
    let mut common: Vec<&str> = vec![];
    for i in 0..split[0].len() {
        let part = split[0][i];
        // Au moins une configuration doit garder un nom propre : on laisse toujours un segment de côté.
        if split.iter().all(|s| s.len() > i + 1 && s[i] == part) {
            common.push(part);
        } else {
            break;
        }
    }
    let title = common.join(TITLE_SEP);
    (title.chars().count() >= 3).then_some(title)
}

/// Retire le titre commun et son séparateur d'un nom de configuration.
fn strip_title(name: &str, title: &str) -> String {
    name.strip_prefix(title)
        .and_then(|rest| rest.strip_prefix(TITLE_SEP))
        .map(str::to_string)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| name.to_string())
}

#[tauri::command]
pub fn list_cars(app: AppHandle) -> Result<Vec<Car>, String> {
    let ac = crate::config::require_ac(&app)?;
    let dir = ac.join("content").join("cars");
    let official = load_official(&ac);
    let mut cars: Vec<Car> = subdirs(&dir)
        .into_iter()
        .map(|id| {
            let ui = read_text(&dir.join(&id).join("ui").join("ui_car.json")).unwrap_or_default();
            let field = |k: &str| json_field(&ui, k).unwrap_or_default();
            let (origin, pack) = match official.cars.get(&id.to_lowercase()) {
                None => ("mod", String::new()),
                Some(None) => ("base", String::new()),
                Some(Some(code)) => ("dlc", official.packs.get(code).cloned().unwrap_or_else(|| code.clone())),
            };
            Car {
                name: json_field(&ui, "name").unwrap_or_else(|| id.clone()),
                origin: origin.to_string(),
                pack,
                brand: field("brand"),
                class: field("class").to_lowercase(),
                bhp: field("bhp"),
                weight: field("weight"),
                top_speed: field("topspeed"),
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
            let layout_of = |layout_id: String, ui: &str, fallback: String| {
                let name = json_field(ui, "name").unwrap_or(fallback);
                TrackLayout {
                    label: name.clone(),
                    name,
                    country: json_field(ui, "country").unwrap_or_default(),
                    length: json_field(ui, "length").unwrap_or_default(),
                    pitboxes: json_field(ui, "pitboxes").unwrap_or_default(),
                    id: layout_id,
                }
            };
            if let Some(ui) = read_text(&ui_dir.join("ui_track.json")) {
                name = json_field(&ui, "name");
                layouts.push(layout_of(String::new(), &ui, id.clone()));
            }
            for layout in subdirs(&ui_dir) {
                if let Some(ui) = read_text(&ui_dir.join(&layout).join("ui_track.json")) {
                    layouts.push(layout_of(layout.clone(), &ui, layout));
                }
            }
            if layouts.is_empty() {
                return None;
            }
            // Plusieurs configurations sans nom propre au circuit : on déduit son nom de leur partie commune.
            let names: Vec<&str> = layouts.iter().map(|l| l.name.as_str()).collect();
            if let Some(common) = common_title(&names) {
                for l in &mut layouts {
                    l.label = strip_title(&l.name, &common);
                }
                if name.is_none() {
                    name = Some(common);
                }
            }
            let name = name.or_else(|| layouts.first().map(|l| l.name.clone()));
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

