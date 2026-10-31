//! Commandes d'Assetto Corsa : méthode de conduite (clavier, manette, volant), détection des appareils
//! et réglage des touches dans `Documents/Assetto Corsa/cfg/controls.ini`.
//!
//! Le fichier est modifié clé par clé (commentaires et réglages inconnus conservés) ; l'original est
//! sauvegardé une seule fois dans `controls.ini.nexora.bak`.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

const FILE: &str = "controls.ini";
const BACKUP: &str = "controls.ini.nexora.bak";

/// Sections lisibles et modifiables depuis l'interface.
const SECTIONS: [&str; 12] = ["HEADER", "ADVANCED", "X360", "KEYBOARD", "STEER", "THROTTLE", "BRAKES", "CLUTCH", "HANDBRAKE", "GEARUP", "GEARDN", "STARTER"];

/// Actions rattachées à une touche / un bouton (une section chacune dans le fichier).
const ACTIONS: [&str; 30] = [
    "BALANCEUP", "BALANCEDN", "KERS", "DRS", "ABSUP", "ABSDN", "TCUP", "TCDN", "TURBOUP", "TURBODN", "ENGINE_BRAKE_UP", "ENGINE_BRAKE_DN",
    "GLANCELEFT", "GLANCERIGHT", "GLANCEBACK", "ACTION_CHANGE_CAMERA", "ACTION_HEADLIGHTS", "ACTION_HEADLIGHTS_FLASH", "ACTION_HORN",
    "ACTION_CELEBRATE", "ACTION_CLAIM", "RESET_RACE", "ACTIVATE_AI", "AUTO_SHIFTER", "ABS", "TRACTION_CONTROL", "IDEAL_LINE", "HIDE_APPS",
    "MOUSE_STEERING", "DRIVER_NAMES",
];

const KEYS: [&str; 33] = [
    "INPUT_METHOD", "COMBINE_WITH_KEYBOARD_CONTROL", "STEER_THUMB", "STEER_GAMMA", "STEER_FILTER", "SPEED_SENSITIVITY", "STEER_DEADZONE", "STEER_SPEED",
    "RUMBLE_INTENSITY", "JOYPAD_INDEX", "MOUSE_STEER", "MOUSE_ACCELERATOR_BRAKE", "MOUSE_SPEED", "STEERING_SPEED", "STEERING_OPPOSITE_DIRECTION_SPEED",
    "STEER_RESET_SPEED", "GAS", "BRAKE", "LEFT", "RIGHT", "JOY", "AXLE", "BUTTON", "KEY", "XBOXBUTTON", "MIN", "MAX", "GAMMA", "SCALE", "LOCK", "FF_GAIN",
    "FILTER_FF", "DEBOUNCING_MS",
];

const METHODS: [&str; 4] = ["KEYBOARD", "X360", "JOYPAD", "WHEEL"];

type Values = BTreeMap<String, BTreeMap<String, String>>;

/// Valeurs des sections demandées (clés en majuscules, commentaires finaux retirés).
fn read_sections(text: &str, wanted: &dyn Fn(&str) -> bool) -> Values {
    let mut out = Values::new();
    let mut current: Option<String> = None;
    for line in text.lines() {
        let t = line.trim();
        if let Some(name) = t.strip_prefix('[').and_then(|s| s.strip_suffix(']')) {
            let name = name.to_uppercase();
            current = wanted(&name).then_some(name);
        } else if let (Some(section), false) = (&current, t.starts_with(';')) {
            if let Some((k, v)) = t.split_once('=') {
                let value = v.split(';').next().unwrap_or("").trim().to_string();
                out.entry(section.clone()).or_default().entry(k.trim().to_uppercase()).or_insert(value);
            }
        }
    }
    out
}

/// Appareils déjà connus d'Assetto Corsa : section `[CONTROLLERS]` (`CONn` = nom, `PGUIDn` = identifiant USB).
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Device {
    /// Numéro utilisé par `JOY=` dans le fichier ; `None` tant qu'Assetto Corsa n'a pas vu l'appareil.
    index: Option<usize>,
    name: String,
    vid: Option<u16>,
    pid: Option<u16>,
    connected: bool,
}

/// `PGUID` = `PPPPVVVV-0000-…` : identifiant produit puis constructeur, en hexadécimal.
fn parse_guid(guid: &str) -> Option<(u16, u16)> {
    let head = guid.trim().split('-').next()?;
    if head.len() != 8 {
        return None;
    }
    let pid = u16::from_str_radix(&head[0..4], 16).ok()?;
    let vid = u16::from_str_radix(&head[4..8], 16).ok()?;
    Some((vid, pid))
}

fn known_devices(text: &str) -> Vec<Device> {
    let v = read_sections(text, &|s| s == "CONTROLLERS");
    let Some(section) = v.get("CONTROLLERS") else { return vec![] };
    let mut out = vec![];
    for i in 0..64 {
        let Some(name) = section.get(&format!("CON{i}")) else { break };
        let ids = section.get(&format!("PGUID{i}")).and_then(|g| parse_guid(g));
        out.push(Device { index: Some(i), name: name.clone(), vid: ids.map(|x| x.0), pid: ids.map(|x| x.1), connected: false });
    }
    out
}

/// Appareils de jeu actuellement branchés : (constructeur, produit, nom).
#[cfg(windows)]
fn connected_now() -> Vec<(u16, u16, String)> {
    use winreg::RegKey;
    use winreg::enums::HKEY_CURRENT_USER;

    #[repr(C)]
    struct JoyCaps {
        mid: u16,
        pid: u16,
        name: [u16; 32],
        numbers: [u32; 19],
        reg_key: [u16; 32],
        oem: [u16; 260],
    }
    #[repr(C)]
    struct JoyInfoEx {
        size: u32,
        flags: u32,
        rest: [u32; 11],
    }
    #[link(name = "winmm")]
    unsafe extern "system" {
        fn joyGetNumDevs() -> u32;
        fn joyGetDevCapsW(id: usize, caps: *mut JoyCaps, size: u32) -> u32;
        fn joyGetPosEx(id: u32, info: *mut JoyInfoEx) -> u32;
    }

    let oem = RegKey::predef(HKEY_CURRENT_USER).open_subkey("System\\CurrentControlSet\\Control\\MediaProperties\\PrivateProperties\\Joystick\\OEM").ok();
    let mut out = vec![];
    // SAFETY : appels winmm avec des tampons de la taille attendue ; un identifiant inutilisé renvoie simplement une erreur.
    unsafe {
        for id in 0..joyGetNumDevs().min(16) {
            let mut info = JoyInfoEx { size: 52, flags: 0xFF, rest: [0; 11] };
            if joyGetPosEx(id, &mut info) != 0 {
                continue;
            }
            let mut caps: JoyCaps = std::mem::zeroed();
            if joyGetDevCapsW(id as usize, &mut caps, std::mem::size_of::<JoyCaps>() as u32) != 0 {
                continue;
            }
            let from_caps = String::from_utf16_lossy(&caps.name).trim_end_matches('\0').to_string();
            let friendly = oem
                .as_ref()
                .and_then(|k| k.open_subkey(format!("VID_{:04X}&PID_{:04X}", caps.mid, caps.pid)).ok())
                .and_then(|k| k.get_value::<String, _>("OEMName").ok())
                .filter(|n| !n.trim().is_empty());
            out.push((caps.mid, caps.pid, friendly.unwrap_or(from_caps)));
        }
    }
    out
}

#[cfg(not(windows))]
fn connected_now() -> Vec<(u16, u16, String)> {
    vec![]
}

/// Liste d'Assetto Corsa, marquée « branché » selon l'état réel de Windows, complétée par les appareils qu'il ne connaît pas encore.
fn merge_devices(mut known: Vec<Device>, live: &[(u16, u16, String)]) -> Vec<Device> {
    let mut used = vec![false; live.len()];
    for dev in &mut known {
        let hit = live.iter().enumerate().find(|(i, (v, p, _))| !used[*i] && Some(*v) == dev.vid && Some(*p) == dev.pid);
        if let Some((i, _)) = hit {
            used[i] = true;
            dev.connected = true;
        }
    }
    for (i, (vid, pid, name)) in live.iter().enumerate() {
        if !used[i] {
            known.push(Device { index: None, name: name.clone(), vid: Some(*vid), pid: Some(*pid), connected: true });
        }
    }
    known
}

/// Appareil USB ou Bluetooth actuellement branché (hors hubs et interfaces internes).
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Peripheral {
    name: String,
    /// Classe Windows (« HIDClass », « Keyboard », « Mouse », « MEDIA », « Bluetooth »…).
    class: String,
    /// « usb » ou « bluetooth ».
    bus: &'static str,
}

/// Noms que Windows donne aux éléments techniques : sans intérêt pour le joueur.
fn is_noise(name: &str, class: &str) -> bool {
    let n = name.to_lowercase();
    // Classe « USB » : hubs, contrôleurs et appareils composites. Les entrées HID génériques n'ont pas de nom parlant.
    class.eq_ignore_ascii_case("USB")
        || n.contains("usb input device")
        || n.contains("entrée usb")
        || n.starts_with("bluetooth device (")
        || n.is_empty()
}

#[cfg(windows)]
fn peripherals() -> Vec<Peripheral> {
    use std::ffi::c_void;

    #[repr(C)]
    struct DevPropKey {
        guid: [u8; 16],
        pid: u32,
    }
    // {a45c254e-df1c-4efd-8020-67d146a850e0}
    const GUID: [u8; 16] = [0x4e, 0x25, 0x5c, 0xa4, 0x1c, 0xdf, 0xfd, 0x4e, 0x80, 0x20, 0x67, 0xd1, 0x46, 0xa8, 0x50, 0xe0];
    const FRIENDLY_NAME: DevPropKey = DevPropKey { guid: GUID, pid: 14 };
    const DEVICE_DESC: DevPropKey = DevPropKey { guid: GUID, pid: 2 };
    const CLASS: DevPropKey = DevPropKey { guid: GUID, pid: 9 };
    // Uniquement les appareils présents, filtrés par bus.
    const FILTER_ENUMERATOR_PRESENT: u32 = 0x1 | 0x100;

    #[link(name = "cfgmgr32")]
    unsafe extern "system" {
        fn CM_Get_Device_ID_List_SizeW(len: *mut u32, filter: *const u16, flags: u32) -> u32;
        fn CM_Get_Device_ID_ListW(filter: *const u16, buffer: *mut u16, len: u32, flags: u32) -> u32;
        fn CM_Locate_DevNodeW(dev: *mut u32, id: *const u16, flags: u32) -> u32;
        fn CM_Get_DevNode_PropertyW(dev: u32, key: *const DevPropKey, kind: *mut u32, buffer: *mut c_void, len: *mut u32, flags: u32) -> u32;
    }

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    // SAFETY : les tampons passés ont la taille annoncée à chaque appel ; toute erreur de Windows est un code de retour non nul.
    unsafe fn text(dev: u32, key: &DevPropKey) -> String {
        unsafe {
            let (mut kind, mut len) = (0u32, 0u32);
            CM_Get_DevNode_PropertyW(dev, key, &mut kind, std::ptr::null_mut(), &mut len, 0);
            if len < 2 {
                return String::new();
            }
            let mut buf = vec![0u16; (len as usize).div_ceil(2)];
            if CM_Get_DevNode_PropertyW(dev, key, &mut kind, buf.as_mut_ptr().cast(), &mut len, 0) != 0 {
                return String::new();
            }
            String::from_utf16_lossy(&buf).trim_end_matches('\0').to_string()
        }
    }

    let mut out: Vec<Peripheral> = vec![];
    for (enumerator, bus) in [("USB", "usb"), ("BTHENUM", "bluetooth")] {
        let filter = wide(enumerator);
        // SAFETY : voir ci-dessus.
        unsafe {
            let mut len = 0u32;
            if CM_Get_Device_ID_List_SizeW(&mut len, filter.as_ptr(), FILTER_ENUMERATOR_PRESENT) != 0 || len < 2 {
                continue;
            }
            let mut ids = vec![0u16; len as usize];
            if CM_Get_Device_ID_ListW(filter.as_ptr(), ids.as_mut_ptr(), len, FILTER_ENUMERATOR_PRESENT) != 0 {
                continue;
            }
            for id in ids.split(|c| *c == 0).filter(|s| !s.is_empty()) {
                let id_text = String::from_utf16_lossy(id).to_uppercase();
                // Les interfaces d'un appareil composite (…&MI_00) et les services Bluetooth répètent l'appareil principal.
                if id_text.contains("&MI_") || (bus == "bluetooth" && !id_text.contains("DEV_")) {
                    continue;
                }
                let mut node = 0u32;
                let mut zero_terminated = id.to_vec();
                zero_terminated.push(0);
                if CM_Locate_DevNodeW(&mut node, zero_terminated.as_ptr(), 0) != 0 {
                    continue;
                }
                let mut name = text(node, &FRIENDLY_NAME);
                if name.is_empty() {
                    name = text(node, &DEVICE_DESC);
                }
                let class = text(node, &CLASS);
                if !is_noise(&name, &class) && !out.iter().any(|p| p.name == name && p.bus == bus) {
                    out.push(Peripheral { name, class, bus });
                }
            }
        }
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

#[cfg(not(windows))]
fn peripherals() -> Vec<Peripheral> {
    vec![]
}

fn current(cfg: &Path) -> ControlsState {
    let mut state = state_in(cfg, &connected_now());
    state.peripherals = peripherals();
    state
}

#[derive(Serialize)]
pub struct ControlsState {
    values: Values,
    /// Autres appareils USB / Bluetooth branchés (clavier, souris, casque…), rafraîchis par la page toutes les 5 s.
    peripherals: Vec<Peripheral>,
    devices: Vec<Device>,
    has_backup: bool,
    /// `controls.ini` existe (sinon Assetto Corsa le crée au premier lancement).
    exists: bool,
}

fn state_in(cfg: &Path, live: &[(u16, u16, String)]) -> ControlsState {
    let file = cfg.join(FILE);
    let text = fs::read_to_string(&file).unwrap_or_default();
    let values = read_sections(&text, &|s| SECTIONS.contains(&s) || ACTIONS.contains(&s));
    ControlsState { values, peripherals: vec![], devices: merge_devices(known_devices(&text), live), has_backup: cfg.join(BACKUP).is_file(), exists: file.is_file() }
}

#[derive(Deserialize, Debug)]
pub struct Change {
    section: String,
    key: String,
    value: String,
}

fn valid_change(c: &Change) -> Result<(), String> {
    let section = c.section.to_uppercase();
    if !SECTIONS.contains(&section.as_str()) && !ACTIONS.contains(&section.as_str()) {
        return Err(format!("Section inconnue : {}", c.section));
    }
    if !KEYS.contains(&c.key.to_uppercase().as_str()) {
        return Err(format!("Réglage inconnu : {}", c.key));
    }
    // Une valeur est un nombre, un nom (LEFT, A, DPAD_UP…) ou un code de touche suivi d'un commentaire (« 0x26 ; Up Arrow »).
    let ok = c.value.len() <= 60
        && !c.value.is_empty()
        && c.value.chars().all(|ch| ch.is_ascii_alphanumeric() || " _-.;()+/".contains(ch));
    if ok { Ok(()) } else { Err(format!("Valeur refusée pour {} : {:?}", c.key, c.value)) }
}

fn apply_changes(text: &str, changes: &[Change]) -> Result<String, String> {
    for c in changes {
        valid_change(c)?;
        if c.key.eq_ignore_ascii_case("INPUT_METHOD") && !METHODS.contains(&c.value.to_uppercase().as_str()) {
            return Err(format!("Méthode de conduite inconnue : {}", c.value));
        }
    }
    let updates: Vec<(&str, &str, String)> = changes.iter().map(|c| (c.section.as_str(), c.key.as_str(), c.value.clone())).collect();
    Ok(crate::ini::set_values(text, &updates))
}

fn write_changes(cfg: &Path, changes: &[Change]) -> Result<(), String> {
    let file = cfg.join(FILE);
    let text = fs::read_to_string(&file).unwrap_or_default();
    let new = apply_changes(&text, changes)?;
    let backup = cfg.join(BACKUP);
    if file.is_file() && !backup.exists() {
        let _ = fs::copy(&file, &backup);
    }
    fs::write(&file, new).map_err(|e| format!("Écriture de controls.ini impossible : {e}"))
}

fn restore_in(cfg: &Path) -> Result<(), String> {
    let backup = cfg.join(BACKUP);
    if !backup.is_file() {
        return Err("Aucune sauvegarde de controls.ini : rien à restaurer.".into());
    }
    fs::copy(&backup, cfg.join(FILE)).map(|_| ()).map_err(|e| format!("Restauration impossible : {e}"))
}

#[tauri::command]
pub fn controls_state() -> Result<ControlsState, String> {
    Ok(current(&crate::race::cfg_dir()?))
}

#[tauri::command]
pub fn set_controls(changes: Vec<Change>) -> Result<ControlsState, String> {
    let cfg = crate::race::cfg_dir()?;
    write_changes(&cfg, &changes)?;
    Ok(current(&cfg))
}

#[tauri::command]
pub fn restore_controls() -> Result<ControlsState, String> {
    let cfg = crate::race::cfg_dir()?;
    restore_in(&cfg)?;
    Ok(current(&cfg))
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "[HEADER]\r\nINPUT_METHOD=X360\r\n\r\n[KEYBOARD]\r\nGAS=0x26 ; Up Arrow\r\nBRAKE=0x28 ; Down Arrow\r\n\r\n[CONTROLLERS]\r\nCON0=Stadia Controller rev. A\r\n__IGUID0=147D8410-D50C-11F1-8001-444553540000\r\nPGUID0=940018D1-0000-0000-0000-504944564944\r\nCON1=Xbox 360\r\nPGUID1=028E045E-0000-0000-0000-504944564944\r\n\r\n[GEARUP]\r\nJOY=-1\r\nBUTTON=-1\r\nKEY=0x20 ; Space\r\nXBOXBUTTON=RSHOULDER\r\n";

    fn change(section: &str, key: &str, value: &str) -> Change {
        Change { section: section.into(), key: key.into(), value: value.into() }
    }

    #[test]
    fn reads_values_without_comments() {
        let v = read_sections(SAMPLE, &|s| SECTIONS.contains(&s));
        assert_eq!(v["HEADER"]["INPUT_METHOD"], "X360");
        assert_eq!(v["KEYBOARD"]["GAS"], "0x26");
        assert_eq!(v["GEARUP"]["XBOXBUTTON"], "RSHOULDER");
        assert!(!v.contains_key("CONTROLLERS"));
    }

    #[test]
    fn reads_the_devices_assetto_corsa_knows() {
        let devices = known_devices(SAMPLE);
        assert_eq!(devices.len(), 2);
        assert_eq!(devices[0].name, "Stadia Controller rev. A");
        assert_eq!((devices[0].vid, devices[0].pid), (Some(0x18D1), Some(0x9400)));
        assert_eq!((devices[1].vid, devices[1].pid), (Some(0x045E), Some(0x028E)));
    }

    #[test]
    fn marks_connected_devices_and_adds_unknown_ones() {
        let live = vec![(0x045E, 0x028E, "Xbox 360 Controller".to_string()), (0x046D, 0xC24F, "G29 Driving Force Racing Wheel".to_string())];
        let merged = merge_devices(known_devices(SAMPLE), &live);
        assert_eq!(merged.len(), 3);
        assert!(!merged[0].connected && merged[1].connected);
        assert_eq!((merged[2].index, merged[2].connected), (None, true));
        assert_eq!(merged[2].name, "G29 Driving Force Racing Wheel");
    }

    #[test]
    fn changes_one_binding_and_keeps_the_rest() {
        let out = apply_changes(SAMPLE, &[change("keyboard", "GAS", "0x57 ; W"), change("HEADER", "INPUT_METHOD", "wheel")]).unwrap();
        let v = read_sections(&out, &|s| SECTIONS.contains(&s));
        assert_eq!(v["KEYBOARD"]["GAS"], "0x57");
        assert_eq!(v["KEYBOARD"]["BRAKE"], "0x28");
        assert_eq!(v["HEADER"]["INPUT_METHOD"], "wheel");
        assert!(out.contains("PGUID1=028E045E") && out.contains("; Down Arrow"));
    }

    #[test]
    fn refuses_unknown_targets_and_dangerous_values() {
        assert!(apply_changes(SAMPLE, &[change("CONTROLLERS", "CON0", "x")]).is_err());
        assert!(apply_changes(SAMPLE, &[change("KEYBOARD", "EVIL", "1")]).is_err());
        assert!(apply_changes(SAMPLE, &[change("KEYBOARD", "GAS", "1\r\n[HEADER]")]).is_err());
        assert!(apply_changes(SAMPLE, &[change("HEADER", "INPUT_METHOD", "TELEPORT")]).is_err());
        assert!(apply_changes(SAMPLE, &[change("KEYBOARD", "GAS", "")]).is_err());
    }

    #[test]
    fn writes_a_backup_once_and_restores_it() {
        let dir = std::env::temp_dir().join("nexora_controls_test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(FILE), SAMPLE).unwrap();
        write_changes(&dir, &[change("HEADER", "INPUT_METHOD", "WHEEL")]).unwrap();
        write_changes(&dir, &[change("HEADER", "INPUT_METHOD", "KEYBOARD")]).unwrap();
        assert_eq!(fs::read_to_string(dir.join(BACKUP)).unwrap(), SAMPLE);
        assert!(state_in(&dir, &[]).has_backup);
        restore_in(&dir).unwrap();
        assert_eq!(fs::read_to_string(dir.join(FILE)).unwrap(), SAMPLE);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn lists_what_is_plugged_in_on_this_machine() {
        // Ne doit jamais planter, même sans aucun appareil.
        let _ = connected_now();
        for p in peripherals() {
            println!("{} | {} | {}", p.bus, p.class, p.name);
            assert!(!is_noise(&p.name, &p.class));
        }
    }

    #[test]
    fn hides_technical_entries() {
        assert!(is_noise("USB Root Hub (USB 3.0)", "USB"));
        assert!(is_noise("Périphérique USB composite", "USB"));
        assert!(is_noise("Périphérique d’entrée USB", "HIDClass"));
        assert!(!is_noise("Logitech G29 Driving Force Racing Wheel", "HIDClass"));
    }
}
