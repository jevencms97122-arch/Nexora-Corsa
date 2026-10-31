use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::fmt::Write as _;
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

const MAX_LOG_LINES: usize = 500;

#[derive(Deserialize, Clone)]
pub struct ServerCar {
    pub model: String,
    pub skin: String,
    pub count: u32,
}

#[derive(Deserialize, Clone)]
pub struct ServerSettings {
    pub name: String,
    pub password: String,
    pub admin_password: String,
    pub track: String,
    pub track_config: String,
    pub cars: Vec<ServerCar>,
    pub max_clients: u32,
    pub udp_port: u16,
    pub tcp_port: u16,
    pub http_port: u16,
    pub register_to_lobby: bool,
    pub pickup_mode: bool,
    pub practice_min: u32,
    pub qualify_min: u32,
    pub race_laps: u32,
    pub race_wait_secs: u32,
    pub weather: String,
    pub hour: f32,
    pub ambient_temp: u32,
    /// 0 = interdit, 1 = d'origine, 2 = forcé
    pub abs: u8,
    pub tc: u8,
    pub stability: bool,
    pub autoclutch: bool,
    pub damage: u32,
    pub fuel: u32,
    pub tyre_wear: u32,
}

#[derive(Serialize, Clone, Default)]
pub struct ServerStatus {
    pub running: bool,
    pub name: String,
    pub udp_port: u16,
    pub tcp_port: u16,
    pub http_port: u16,
    pub has_password: bool,
}

#[derive(Default)]
struct Inner {
    child: Option<Child>,
    status: ServerStatus,
    log: VecDeque<String>,
}

#[derive(Default, Clone)]
pub struct ServerState(Arc<Mutex<Inner>>);

impl ServerState {
    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Arrête le serveur s'il tourne. Renvoie vrai s'il y avait quelque chose à arrêter.
    pub fn stop(&self) -> bool {
        let mut inner = self.lock();
        let Some(mut child) = inner.child.take() else { return false };
        let _ = child.kill();
        let _ = child.wait();
        inner.status.running = false;
        true
    }
}

fn clean(value: &str) -> String {
    value.replace(['\r', '\n'], " ").trim().to_string()
}

fn server_cfg(s: &ServerSettings) -> String {
    let models: Vec<&str> = {
        let mut m: Vec<&str> = vec![];
        for c in &s.cars {
            if !m.contains(&c.model.as_str()) {
                m.push(&c.model);
            }
        }
        m
    };
    let sun_angle = ((s.hour.clamp(8.0, 18.0) - 13.0) * 16.0).round() as i32;
    let on = |b: bool| u8::from(b);
    let mut out = String::new();
    let _ = write!(
        out,
        "[SERVER]\nNAME={name}\nCARS={cars}\nCONFIG_TRACK={config}\nTRACK={track}\nSUN_ANGLE={sun}\n\
         PASSWORD={pw}\nADMIN_PASSWORD={admin}\nUDP_PORT={udp}\nTCP_PORT={tcp}\nHTTP_PORT={http}\n\
         PICKUP_MODE_ENABLED={pickup}\nLOOP_MODE=1\nSLEEP_TIME=1\nCLIENT_SEND_INTERVAL_HZ=18\n\
         SEND_BUFFER_SIZE=0\nRECV_BUFFER_SIZE=0\nRACE_OVER_TIME=180\nKICK_QUORUM=85\nVOTING_QUORUM=80\nVOTE_DURATION=20\n\
         BLACKLIST_MODE=1\nFUEL_RATE={fuel}\nDAMAGE_MULTIPLIER={damage}\nTYRE_WEAR_RATE={tyres}\nALLOWED_TYRES_OUT=2\n\
         ABS_ALLOWED={abs}\nTC_ALLOWED={tc}\nSTABILITY_ALLOWED={stab}\nAUTOCLUTCH_ALLOWED={clutch}\n\
         TYRE_BLANKETS_ALLOWED=0\nFORCE_VIRTUAL_MIRROR=1\nREGISTER_TO_LOBBY={lobby}\nMAX_CLIENTS={max}\n\
         UDP_PLUGIN_LOCAL_PORT=0\nUDP_PLUGIN_ADDRESS=\nAUTH_PLUGIN_ADDRESS=\nLEGAL_TYRES=SV;H;M;S;ST;SS\n",
        name = clean(&s.name),
        cars = models.join(";"),
        config = s.track_config,
        track = s.track,
        sun = sun_angle,
        pw = clean(&s.password),
        admin = clean(&s.admin_password),
        udp = s.udp_port,
        tcp = s.tcp_port,
        http = s.http_port,
        pickup = on(s.pickup_mode),
        fuel = s.fuel,
        damage = s.damage,
        tyres = s.tyre_wear,
        abs = s.abs.min(2),
        tc = s.tc.min(2),
        stab = on(s.stability),
        clutch = on(s.autoclutch),
        lobby = on(s.register_to_lobby),
        max = s.max_clients,
    );
    if s.practice_min > 0 {
        let _ = write!(out, "\n[PRACTICE]\nNAME=Practice\nTIME={}\nIS_OPEN=1\n", s.practice_min);
    }
    if s.qualify_min > 0 {
        let _ = write!(out, "\n[QUALIFY]\nNAME=Qualify\nTIME={}\nIS_OPEN=1\n", s.qualify_min);
    }
    if s.race_laps > 0 {
        let _ = write!(
            out,
            "\n[RACE]\nNAME=Race\nLAPS={}\nWAIT_TIME={}\nIS_OPEN=1\n",
            s.race_laps, s.race_wait_secs
        );
    }
    let amb = s.ambient_temp;
    let _ = write!(
        out,
        "\n[DYNAMIC_TRACK]\nSESSION_START=95\nRANDOMNESS=2\nSESSION_TRANSFER=90\nLAP_GAIN=50\n\
         \n[WEATHER_0]\nGRAPHICS={w}\nBASE_TEMPERATURE_AMBIENT={amb}\nBASE_TEMPERATURE_ROAD={road}\n\
         VARIATION_AMBIENT=1\nVARIATION_ROAD=1\nWIND_BASE_SPEED_MIN=0\nWIND_BASE_SPEED_MAX=0\nWIND_BASE_DIRECTION=0\nWIND_VARIATION_DIRECTION=0\n",
        w = s.weather,
        road = amb + 6,
    );
    out
}

fn entry_list(s: &ServerSettings) -> String {
    let mut slots: Vec<(&str, &str)> = vec![];
    for c in &s.cars {
        for _ in 0..c.count.max(1) {
            slots.push((&c.model, &c.skin));
        }
    }
    let mut out = String::new();
    for i in 0..s.max_clients as usize {
        let (model, skin) = slots[i % slots.len()];
        let _ = write!(
            out,
            "[CAR_{i}]\nMODEL={model}\nSKIN={skin}\nSPECTATOR_MODE=0\nDRIVERNAME=\nTEAM=\nGUID=\nBALLAST=0\nRESTRICTOR=0\n\n"
        );
    }
    out
}

fn copy_filtered(src: &Path, dst: &Path, skip: &dyn Fn(&Path) -> bool) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let path = entry.path();
        if skip(&path) {
            continue;
        }
        let target = dst.join(entry.file_name());
        if path.is_dir() {
            copy_filtered(&path, &target, skip)?;
        } else {
            fs::copy(&path, &target)?;
        }
    }
    Ok(())
}

/// Le serveur lit ses propres dossiers `content`. Le contenu de base y est déjà ;
/// on y copie (sans modèles 3D ni textures) les voitures et circuits moddés manquants.
fn sync_content(ac: &Path, s: &ServerSettings) -> Result<(), String> {
    let server_content = ac.join("server").join("content");
    for car in s.cars.iter().map(|c| c.model.as_str()) {
        let src = ac.join("content").join("cars").join(car);
        let dst = server_content.join("cars").join(car);
        if dst.exists() {
            continue;
        }
        let skip = |p: &Path| p.file_name().is_some_and(|n| n == "skins" || n == "ui" || n == "sfx");
        let big = |p: &Path| skip(p) || p.extension().is_some_and(|e| e == "kn5");
        copy_filtered(&src, &dst, &big).map_err(|e| format!("Copie de la voiture {car} impossible : {e}"))?;
    }
    let dst = server_content.join("tracks").join(&s.track);
    if !dst.exists() {
        let src = ac.join("content").join("tracks").join(&s.track);
        let skip = |p: &Path| {
            p.file_name().is_some_and(|n| n == "skins" || n == "ui")
                || p.extension().is_some_and(|e| matches!(e.to_str(), Some("kn5" | "png" | "jpg")))
        };
        copy_filtered(&src, &dst, &skip).map_err(|e| format!("Copie du circuit {} impossible : {e}", s.track))?;
    }
    Ok(())
}

fn push_log(app: &AppHandle, state: &ServerState, line: String) {
    let mut inner = state.lock();
    if inner.log.len() >= MAX_LOG_LINES {
        inner.log.pop_front();
    }
    inner.log.push_back(line.clone());
    drop(inner);
    let _ = app.emit("server-log", line);
}

fn pump(app: AppHandle, state: ServerState, stream: impl Read + Send + 'static) {
    thread::spawn(move || {
        let mut reader = BufReader::new(stream);
        let mut buf = Vec::new();
        while reader.read_until(b'\n', &mut buf).unwrap_or(0) > 0 {
            let line = String::from_utf8_lossy(&buf).trim_end().to_string();
            if !line.is_empty() {
                push_log(&app, &state, line);
            }
            buf.clear();
        }
    });
}

#[tauri::command]
pub fn start_server(app: AppHandle, state: State<ServerState>, settings: ServerSettings) -> Result<ServerStatus, String> {
    let ac = crate::config::require_ac(&app)?;
    let exe = ac.join("server").join("acServer.exe");
    if !exe.is_file() {
        return Err("acServer.exe introuvable dans le dossier server du jeu.".into());
    }
    if settings.cars.is_empty() || settings.max_clients == 0 {
        return Err("Choisis au moins une voiture et un nombre de places.".into());
    }
    if settings.practice_min == 0 && settings.qualify_min == 0 && settings.race_laps == 0 {
        return Err("Active au moins une session (essais, qualifs ou course).".into());
    }
    let state = state.inner().clone();
    if state.lock().child.is_some() {
        return Err("Un serveur est déjà en cours d'exécution.".into());
    }

    sync_content(&ac, &settings)?;

    let dir = crate::config::data_dir(&app)?.join("server");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let cfg_path = dir.join("server_cfg.ini");
    let entry_path = dir.join("entry_list.ini");
    fs::write(&cfg_path, server_cfg(&settings)).map_err(|e| e.to_string())?;
    fs::write(&entry_path, entry_list(&settings)).map_err(|e| e.to_string())?;

    let mut cmd = Command::new(&exe);
    cmd.arg("-c")
        .arg(&cfg_path)
        .arg("-e")
        .arg(&entry_path)
        .current_dir(ac.join("server"))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = cmd.spawn().map_err(|e| format!("Démarrage du serveur impossible : {e}"))?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let status = ServerStatus {
        running: true,
        name: clean(&settings.name),
        udp_port: settings.udp_port,
        tcp_port: settings.tcp_port,
        http_port: settings.http_port,
        has_password: !settings.password.trim().is_empty(),
    };
    {
        let mut inner = state.lock();
        inner.log.clear();
        inner.child = Some(child);
        inner.status = status.clone();
    }
    if let Some(s) = stdout {
        pump(app.clone(), state.clone(), s);
    }
    if let Some(s) = stderr {
        pump(app.clone(), state.clone(), s);
    }

    let cars = settings.cars.iter().map(|c| c.model.as_str()).collect::<Vec<_>>().join(", ");
    crate::history::record(
        &app,
        "host",
        &cars,
        &settings.track,
        &format!("{} — {} places", clean(&settings.name), settings.max_clients),
        None,
    );

    // Surveille la fin du processus (arrêt volontaire ou plantage).
    let monitor_app = app.clone();
    thread::spawn(move || {
        loop {
            thread::sleep(Duration::from_millis(500));
            let mut inner = state.lock();
            let Some(child) = inner.child.as_mut() else { break };
            if let Ok(Some(exit)) = child.try_wait() {
                inner.child = None;
                inner.status.running = false;
                drop(inner);
                push_log(&monitor_app, &state, format!("Serveur arrêté ({exit})."));
                let _ = monitor_app.emit("server-stopped", ());
                break;
            }
        }
    });
    Ok(status)
}

#[tauri::command]
pub fn stop_server(app: AppHandle, state: State<ServerState>) {
    if state.stop() {
        let _ = app.emit("server-stopped", ());
    }
}

#[tauri::command]
pub fn server_status(state: State<ServerState>) -> ServerStatus {
    state.lock().status.clone()
}

#[tauri::command]
pub fn server_log(state: State<ServerState>) -> Vec<String> {
    state.lock().log.iter().cloned().collect()
}
