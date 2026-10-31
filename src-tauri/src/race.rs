use serde::{Deserialize, Serialize};
use std::fmt::Write as _;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::AppHandle;

#[derive(Deserialize, Serialize)]
pub struct SoloSettings {
    pub car: String,
    pub skin: String,
    pub track: String,
    pub track_config: String,
    pub player_name: String,
    pub ai_count: u32,
    pub ai_level: u32,
    pub weather: String,
    /// Heure de la journée, 8 à 18.
    pub hour: f32,
    /// "practice" | "qualify" | "race"
    pub session: String,
    pub duration_min: u32,
    pub laps: u32,
    pub ambient_temp: u32,
}

#[derive(Deserialize)]
pub struct JoinSettings {
    pub ip: String,
    pub tcp_port: u16,
    pub http_port: u16,
    pub password: String,
    pub car: String,
    pub skin: String,
    pub player_name: String,
}

/// Dossier `Documents/Assetto Corsa/cfg` (Documents peut être redirigé, ex. OneDrive).
fn cfg_dir() -> Result<PathBuf, String> {
    let docs = dirs::document_dir().ok_or("Dossier Documents introuvable.")?;
    let dir = docs.join("Assetto Corsa").join("cfg");
    if !dir.is_dir() {
        return Err("Lance Assetto Corsa une première fois pour créer ses fichiers de configuration.".into());
    }
    Ok(dir)
}

/// Sauvegarde l'ancien race.ini avant de l'écraser, puis écrit le nouveau.
fn write_race_ini(content: &str) -> Result<(), String> {
    let dir = cfg_dir()?;
    let target = dir.join("race.ini");
    if target.is_file() {
        let _ = fs::copy(&target, dir.join("race.ini.nexora.bak"));
    }
    fs::write(&target, content).map_err(|e| format!("Écriture de race.ini impossible : {e}"))
}

fn launch_game(ac: &Path) -> Result<(), String> {
    Command::new(ac.join("acs.exe"))
        .current_dir(ac)
        .spawn()
        .map_err(|e| format!("Impossible de lancer le jeu : {e}"))?;
    Ok(())
}

fn clean(value: &str) -> String {
    value.replace(['\r', '\n'], " ").trim().to_string()
}

fn common_tail(out: &mut String, weather: &str, sun_angle: i32, ambient: u32) {
    let road = ambient + 6;
    let _ = write!(
        out,
        "\n[LIGHTING]\nSUN_ANGLE={sun_angle}\nTIME_MULT=1.0\nCLOUD_SPEED=0.2\n\
         \n[WEATHER]\nNAME={weather}\n\
         \n[TEMPERATURE]\nAMBIENT={ambient}\nROAD={road}\n\
         \n[GROOVE]\nVIRTUAL_LAPS=10\nMAX_LAPS=30\nSTARTING_LAPS=0\n\
         \n[DYNAMIC_TRACK]\nPRESET=3\nSTARTING_LAPS=0\n\
         \n[GHOST_CAR]\nRECORDING=0\nPLAYING=0\nSECONDS_ADVANTAGE=0\nLOAD=0\nFILE=\nENABLED=0\n\
         \n[REPLAY]\nFILENAME=\nACTIVE=0\n\
         \n[LAP_INVALIDATOR]\nALLOWED_TYRES_OUT=-1\n\
         \n[OPTIONS]\nUSE_MPH=0\n\
         \n[WIND]\nSPEED_KMH_MIN=0\nSPEED_KMH_MAX=0\nDIRECTION_DEG=0\n"
    );
}

fn solo_ini(s: &SoloSettings) -> String {
    let name = clean(&s.player_name);
    let sun_angle = ((s.hour.clamp(8.0, 18.0) - 13.0) * 16.0).round() as i32;
    let mut out = String::from("[HEADER]\nVERSION=2\n");
    let _ = write!(
        out,
        "\n[REMOTE]\nACTIVE=0\nSERVER_IP=\nSERVER_PORT=\nSERVER_HTTP_PORT=\nREQUESTED_CAR=\nGUID=\nNAME=\nPASSWORD=\n\
         \n[RACE]\nMODEL={car}\nMODEL_CONFIG=\nSKIN={skin}\nTRACK={track}\nCONFIG_TRACK={config}\n\
         AI_LEVEL={ai_level}\nCARS={cars}\nDRIFT_MODE=0\nFIXED_SETUP=0\nPENALTIES=1\nJUMP_START_PENALTY=0\n\
         \n[CAR_0]\nSETUP=\nSKIN={skin}\nMODEL=-\nMODEL_CONFIG=\nBALLAST=0\nRESTRICTOR=0\nDRIVER_NAME={name}\nNATIONALITY=\nNATION_CODE=\n",
        car = s.car,
        skin = s.skin,
        track = s.track,
        config = s.track_config,
        ai_level = s.ai_level.clamp(30, 100),
        cars = s.ai_count + 1,
    );
    for i in 1..=s.ai_count {
        let _ = write!(
            out,
            "\n[CAR_{i}]\nSETUP=\nSKIN={skin}\nMODEL={car}\nMODEL_CONFIG=\nBALLAST=0\nRESTRICTOR=0\nDRIVER_NAME=Pilote {i}\n\
             NATIONALITY=\nNATION_CODE=\nAI_LEVEL={lvl}\nAI_AGGRESSION=0\n",
            skin = s.skin,
            car = s.car,
            lvl = s.ai_level.clamp(30, 100),
        );
    }
    let session = match s.session.as_str() {
        "race" => format!("NAME=Race\nTYPE=3\nLAPS={}\nDURATION_MINUTES=0\nSPAWN_SET=START\n", s.laps.max(1)),
        "qualify" => format!("NAME=Qualify\nTYPE=2\nDURATION_MINUTES={}\nSPAWN_SET=PIT\n", s.duration_min.max(1)),
        _ => format!("NAME=Practice\nTYPE=1\nDURATION_MINUTES={}\nSPAWN_SET=PIT\n", s.duration_min.max(1)),
    };
    let _ = write!(out, "\n[SESSION_0]\n{session}");
    common_tail(&mut out, &s.weather, sun_angle, s.ambient_temp);
    out
}

fn join_ini(j: &JoinSettings) -> Result<String, String> {
    let guid = crate::game::steam_id().ok_or("Compte Steam introuvable : ouvre Steam et connecte-toi.")?;
    let name = clean(&j.player_name);
    let mut out = String::from("[HEADER]\nVERSION=2\n");
    let _ = write!(
        out,
        "\n[REMOTE]\nACTIVE=1\nSERVER_IP={ip}\nSERVER_PORT={tcp}\nSERVER_HTTP_PORT={http}\nREQUESTED_CAR={car}\nGUID={guid}\nNAME={name}\nPASSWORD={pw}\n\
         \n[RACE]\nMODEL={car}\nMODEL_CONFIG=\nSKIN={skin}\nTRACK=\nCONFIG_TRACK=\nAI_LEVEL=100\nCARS=1\nDRIFT_MODE=0\nFIXED_SETUP=0\nPENALTIES=1\nJUMP_START_PENALTY=0\n\
         \n[CAR_0]\nSETUP=\nSKIN={skin}\nMODEL=-\nMODEL_CONFIG=\nBALLAST=0\nRESTRICTOR=0\nDRIVER_NAME={name}\nNATIONALITY=\nNATION_CODE=\n\
         \n[SESSION_0]\nNAME=Practice\nTYPE=1\nDURATION_MINUTES=0\nSPAWN_SET=PIT\n",
        ip = clean(&j.ip),
        tcp = j.tcp_port,
        http = j.http_port,
        car = j.car,
        skin = j.skin,
        pw = clean(&j.password),
    );
    common_tail(&mut out, "3_clear", 0, 26);
    Ok(out)
}

#[tauri::command]
pub fn launch_solo(app: AppHandle, settings: SoloSettings) -> Result<(), String> {
    let ac = crate::config::require_ac(&app)?;
    write_race_ini(&solo_ini(&settings))?;
    launch_game(&ac)?;
    let detail = match settings.session.as_str() {
        "race" => format!("Course, {} tours", settings.laps),
        "qualify" => format!("Qualifications, {} min", settings.duration_min),
        _ => format!("Essais, {} min", settings.duration_min),
    };
    crate::history::record(&app, "solo", &settings.car, &settings.track, &detail, serde_json::to_value(&settings).ok());
    Ok(())
}

#[tauri::command]
pub fn join_server(app: AppHandle, settings: JoinSettings) -> Result<(), String> {
    let ac = crate::config::require_ac(&app)?;
    write_race_ini(&join_ini(&settings)?)?;
    launch_game(&ac)?;
    let detail = format!("Serveur {}:{}", settings.ip, settings.tcp_port);
    crate::history::record(&app, "join", &settings.car, "", &detail, None);
    Ok(())
}
