use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io;
use std::path::{Component, Path, PathBuf};
use tauri::AppHandle;
use zip::ZipArchive;

/// Formats d'archives pris en charge.
const SUPPORTED: [&str; 3] = ["zip", "7z", "rar"];
/// Garde-fou contre les archives piégées qui rempliraient le disque.
const MAX_EXTRACT_BYTES: u64 = 8 * 1024 * 1024 * 1024;

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
    /// Dossiers déjà présents que l'installation va remplacer (mods de ciel), ex. `content/weather/1_heavy_fog`.
    pub replaces: Vec<String>,
    /// Où les fichiers remplacés ont été sauvegardés (après installation).
    pub backup: Option<String>,
}

/// Un mod détecté dans l'archive : sa racine dans l'archive (vide si l'archive *est* le mod).
struct Detected {
    kind: &'static str,
    id: String,
    root: Vec<String>,
    /// Chemins des fichiers de ciel que l'installation écrit, relatifs à la racine du jeu : sert à repérer ce qu'elle écraserait.
    files: Vec<Vec<String>>,
}

/// Une entrée d'archive, avec un chemin déjà nettoyé (jamais de `..`, de racine ni de lettre de lecteur).
struct Entry {
    comps: Vec<String>,
    is_dir: bool,
}

fn components(path: &Path) -> Vec<String> {
    path.components()
        .filter_map(|c| match c {
            Component::Normal(s) => Some(s.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect()
}

/// Chemin d'entrée accepté seulement s'il reste à l'intérieur du dossier de destination.
fn clean_entry_path(name: &str) -> Option<Vec<String>> {
    let normalized = name.replace('\\', "/");
    let path = Path::new(&normalized);
    if path.components().any(|c| matches!(c, Component::ParentDir | Component::RootDir | Component::Prefix(_))) {
        return None;
    }
    Some(components(path))
}

fn safe_id(id: &str) -> bool {
    !id.is_empty() && id != "." && id != ".." && !id.contains(['/', '\\', ':'])
}

fn archive_stem(path: &Path) -> String {
    path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default()
}

fn extension(path: &Path) -> String {
    path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default()
}

fn unsupported_format(path: &Path) -> String {
    format!(
        "Format « .{} » non pris en charge (formats acceptés : .zip, .7z, .rar, et .ini pour un filtre d'image).",
        extension(path)
    )
}

/// Archive de Custom Shaders Patch : un `dwrite.dll` accompagné d'un dossier `extension`.
/// Renvoie le dossier de l'archive qui correspond à la racine du jeu.
fn detect_csp(entries: &[Entry]) -> Option<Vec<String>> {
    let dll = entries
        .iter()
        .find(|e| !e.is_dir && e.comps.last().is_some_and(|n| n.eq_ignore_ascii_case("dwrite.dll")))?;
    let root = dll.comps[..dll.comps.len() - 1].to_vec();
    let has_extension = entries
        .iter()
        .any(|e| !e.is_dir && e.comps.starts_with(&root) && e.comps.get(root.len()).is_some_and(|n| n.eq_ignore_ascii_case("extension")));
    has_extension.then_some(root)
}

/// Dossiers (relatifs à la racine du jeu) où un mod de ciel et de météo a le droit d'écrire.
/// Tout le reste de l'archive (applications, textures, exécutables…) est ignoré à l'installation.
const WEATHER_DIRS: [&[&str]; 3] = [&["content", "weather"], &["extension", "weather-controllers"], &["extension", "weather"]];

/// `comps` commence-t-il par `prefix` (sans tenir compte de la casse) et va-t-il plus loin ?
fn under(comps: &[String], prefix: &[&str]) -> bool {
    comps.len() > prefix.len() && comps.iter().zip(prefix).all(|(a, b)| a.eq_ignore_ascii_case(b))
}

fn is_weather_path(rel: &[String]) -> bool {
    WEATHER_DIRS.iter().any(|p| under(rel, p))
}

/// Un mod de ciel repéré : où est la racine du jeu dans l'archive, son nom, et les dossiers qu'il écrit.
struct WeatherMod {
    root: Vec<String>,
    id: String,
    targets: Vec<Vec<String>>,
    files: Vec<Vec<String>>,
}

/// Nom du mod parmi les dossiers qu'il écrit. Le choix ne dépend jamais de l'ordre des fichiers dans l'archive
/// (l'aperçu lit l'archive telle quelle, l'installation la lit après extraction) et préfère le contrôleur, puis le style
/// de ciel, puis un réglage météo qui n'est pas d'origine : « sol » plutôt que « 1_heavy_fog ».
fn weather_id(targets: &[Vec<String>]) -> Option<String> {
    let rank = |t: &Vec<String>| -> (u8, String) {
        let name = t[t.len() - 1].to_lowercase();
        let kind = t[..t.len() - 1].join("/").to_lowercase();
        let priority = match kind.as_str() {
            "extension/weather-controllers" => 0,
            "extension/weather" => 1,
            _ if !crate::graphics::STOCK_WEATHER.contains(&name.as_str()) => 2,
            _ => 3,
        };
        (priority, name)
    };
    targets.iter().min_by_key(|t| rank(t)).map(|t| t[t.len() - 1].clone())
}

/// Mod de ciel (Sol, Pure…) : des fichiers sous `content/weather`, `extension/weather` ou `extension/weather-controllers`.
fn detect_weather(entries: &[Entry]) -> Option<WeatherMod> {
    // Racine du jeu dans l'archive : la plus proche de la surface (puis l'ordre alphabétique, pour rester stable).
    let root = entries
        .iter()
        .filter(|e| !e.is_dir)
        .flat_map(|e| (0..e.comps.len()).filter(|&pos| WEATHER_DIRS.iter().any(|p| under(&e.comps[pos..], p))).map(|pos| e.comps[..pos].to_vec()))
        .min_by_key(|r| (r.len(), r.join("/").to_lowercase()))?;

    let mut targets: Vec<Vec<String>> = vec![];
    let mut files: Vec<Vec<String>> = vec![];
    for e in entries.iter().filter(|e| !e.is_dir && e.comps.starts_with(&root)) {
        let rel = &e.comps[root.len()..];
        if is_weather_path(rel) {
            files.push(rel.to_vec());
        }
        for prefix in WEATHER_DIRS {
            if under(rel, prefix) {
                let target: Vec<String> = prefix.iter().map(|s| s.to_string()).chain([rel[prefix.len()].clone()]).collect();
                if !targets.iter().any(|t| t.join("/").eq_ignore_ascii_case(&target.join("/"))) {
                    targets.push(target);
                }
            }
        }
    }
    let id = weather_id(&targets)?;
    Some(WeatherMod { root, id, targets, files })
}

/// Filtres d'image : des fichiers `.ini` dans un dossier `ppfilters`.
fn detect_filters(entries: &[Entry]) -> Vec<Detected> {
    let mut found: Vec<Detected> = vec![];
    for e in entries.iter().filter(|e| !e.is_dir && e.comps.len() >= 2) {
        let name = &e.comps[e.comps.len() - 1];
        let in_filters_dir = e.comps[e.comps.len() - 2].eq_ignore_ascii_case("ppfilters");
        let stem = Path::new(name).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
        if in_filters_dir && extension(Path::new(name)) == "ini" && safe_id(&stem) && !found.iter().any(|d| d.id == stem) {
            found.push(Detected { kind: "filter", id: stem, root: e.comps.clone(), files: vec![] });
        }
    }
    found
}

/// Un `.ini` isolé est un filtre d'image s'il contient la section `[YEBIS]` (le moteur de post-traitement du jeu).
fn is_filter_ini(path: &Path) -> bool {
    fs::read(path)
        .map(|b| String::from_utf8_lossy(&b[..b.len().min(64 * 1024)]).to_uppercase().contains("[YEBIS]"))
        .unwrap_or(false)
}

/// Repère les voitures et circuits d'une archive grâce à leurs fichiers `ui_car.json` / `ui_track.json`.
fn detect(entries: &[Entry], archive_path: &Path) -> Result<Vec<Detected>, String> {
    if let Some(root) = detect_csp(entries) {
        return Ok(vec![Detected { kind: "csp", id: "custom-shaders-patch".into(), root, files: vec![] }]);
    }
    if let Some(w) = detect_weather(entries) {
        if safe_id(&w.id) && w.targets.iter().all(|t| safe_id(&t[t.len() - 1])) {
            return Ok(vec![Detected { kind: "weather", id: w.id, root: w.root, files: w.files }]);
        }
    }
    let filters = detect_filters(entries);
    if !filters.is_empty() {
        return Ok(filters);
    }
    let mut found: Vec<Detected> = vec![];
    for entry in entries.iter().filter(|e| !e.is_dir) {
        let comps = &entry.comps;
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
        let id = root.last().cloned().unwrap_or_else(|| archive_stem(archive_path));
        if !safe_id(&id) {
            return Err(format!("Nom de mod invalide : {id}"));
        }
        found.push(Detected { kind, id, root, files: vec![] });
    }
    if found.is_empty() {
        return Err("Aucune voiture ni aucun circuit reconnu dans cette archive (ui_car.json / ui_track.json absents).".into());
    }
    Ok(found)
}

// ---------------------------------------------------------------------------------------------
// Lecture des archives
// ---------------------------------------------------------------------------------------------

fn list_zip(path: &Path) -> Result<(ZipArchive<File>, Vec<(usize, Entry)>), String> {
    let file = File::open(path).map_err(|e| format!("Impossible d'ouvrir l'archive : {e}"))?;
    let mut archive = ZipArchive::new(file).map_err(|_| "Ce fichier n'est pas une archive .zip valide.".to_string())?;
    let mut entries = vec![];
    for i in 0..archive.len() {
        let file = archive.by_index(i).map_err(|e| format!("Archive illisible : {e}"))?;
        let Some(p) = file.enclosed_name() else { continue };
        entries.push((i, Entry { comps: components(&p), is_dir: file.is_dir() }));
    }
    Ok((archive, entries))
}

fn list_7z(path: &Path) -> Result<Vec<Entry>, String> {
    let archive = sevenz_rust2::Archive::open(path).map_err(|e| format!("Archive .7z illisible : {e}"))?;
    Ok(archive
        .files
        .iter()
        .filter_map(|f| clean_entry_path(f.name()).map(|comps| Entry { comps, is_dir: f.is_directory() }))
        .collect())
}

fn rar_error(e: unrar::error::UnrarError) -> String {
    let text = e.to_string();
    let lower = text.to_lowercase();
    if lower.contains("password") {
        "Archive .rar protégée par un mot de passe : elle ne peut pas être installée.".into()
    } else if lower.contains("volume") {
        "Archive .rar en plusieurs parties : télécharge toutes les parties dans le même dossier, ou choisis une version en un seul fichier.".into()
    } else {
        format!("Archive .rar illisible : {text}")
    }
}

fn list_rar(path: &Path) -> Result<Vec<Entry>, String> {
    let mut entries = vec![];
    for header in unrar::Archive::new(path).open_for_listing().map_err(rar_error)? {
        let header = header.map_err(rar_error)?;
        if let Some(comps) = clean_entry_path(&header.filename.to_string_lossy()) {
            entries.push(Entry { comps, is_dir: header.is_directory() });
        }
    }
    Ok(entries)
}

/// Un filtre d'image fourni seul (sans archive) est vu comme un fichier de `ppfilters`.
fn list_filter_ini(path: &Path) -> Result<Vec<Entry>, String> {
    if !is_filter_ini(path) {
        return Err("Ce fichier .ini n'est pas un filtre d'image (section [YEBIS] absente).".into());
    }
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    Ok(vec![Entry { comps: vec!["ppfilters".into(), name], is_dir: false }])
}

/// Liste le contenu d'une archive sans rien extraire (sert à l'aperçu avant installation).
fn list_archive(path: &Path) -> Result<Vec<Entry>, String> {
    match extension(path).as_str() {
        "zip" => Ok(list_zip(path)?.1.into_iter().map(|(_, e)| e).collect()),
        "7z" => list_7z(path),
        "rar" => list_rar(path),
        "ini" => list_filter_ini(path),
        _ => Err(unsupported_format(path)),
    }
}

fn extract_7z(path: &Path, dest: &Path) -> Result<(), String> {
    let mut total = 0u64;
    sevenz_rust2::decompress_file_with_extract_fn(path, dest, |entry, reader, out| {
        total += entry.size();
        if total > MAX_EXTRACT_BYTES {
            return Err(sevenz_rust2::Error::Other("archive trop volumineuse une fois décompressée".into()));
        }
        sevenz_rust2::default_entry_extract_fn(entry, reader, out)
    })
    .map_err(|e| format!("Extraction du .7z impossible : {e}"))
}

fn extract_rar(path: &Path, dest: &Path) -> Result<(), String> {
    let mut archive = unrar::Archive::new(path).open_for_processing().map_err(rar_error)?;
    let mut total = 0u64;
    while let Some(header) = archive.read_header().map_err(rar_error)? {
        let entry = header.entry();
        total += entry.unpacked_size;
        if total > MAX_EXTRACT_BYTES {
            return Err("Archive trop volumineuse une fois décompressée.".into());
        }
        // Un chemin qui sortirait du dossier de destination est ignoré, jamais écrit.
        let safe = clean_entry_path(&entry.filename.to_string_lossy()).is_some();
        archive = if safe {
            header.extract_with_base(dest).map_err(rar_error)?
        } else {
            header.skip().map_err(rar_error)?
        };
    }
    Ok(())
}

/// Dossier temporaire supprimé à la fin, y compris en cas d'erreur.
struct TempDir(PathBuf);

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn walk(root: &Path, dir: &Path, out: &mut Vec<(PathBuf, Entry)>) -> io::Result<()> {
    for item in fs::read_dir(dir)? {
        let item = item?;
        let path = item.path();
        let is_dir = item.file_type()?.is_dir();
        if let Ok(rel) = path.strip_prefix(root) {
            out.push((path.clone(), Entry { comps: components(rel), is_dir }));
        }
        if is_dir {
            walk(root, &path, out)?;
        }
    }
    Ok(())
}

/// Archive prête à être copiée dans le jeu : lue en flux pour un zip, extraite d'abord pour un .7z / .rar.
enum Backend {
    Zip(ZipArchive<File>),
    Dir,
}

struct Opened {
    backend: Backend,
    /// Pour chaque entrée : sa position dans l'archive (zip) ou son chemin sur disque (dossier extrait).
    items: Vec<(Source, Entry)>,
    _temp: Option<TempDir>,
}

enum Source {
    ZipIndex(usize),
    File(PathBuf),
}

fn open_for_install(app: &AppHandle, path: &Path) -> Result<Opened, String> {
    match extension(path).as_str() {
        "zip" => {
            let (archive, entries) = list_zip(path)?;
            Ok(Opened {
                backend: Backend::Zip(archive),
                items: entries.into_iter().map(|(i, e)| (Source::ZipIndex(i), e)).collect(),
                _temp: None,
            })
        }
        ext @ ("7z" | "rar") => {
            let base = crate::config::data_dir(app)?.join("extract");
            fs::create_dir_all(&base).map_err(|e| e.to_string())?;
            let unique = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            let dir = base.join(format!("{}-{unique}", std::process::id()));
            fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            let temp = TempDir(dir.clone());
            if ext == "7z" {
                extract_7z(path, &dir)?;
            } else {
                extract_rar(path, &dir)?;
            }
            let mut found = vec![];
            walk(&dir, &dir, &mut found).map_err(|e| format!("Lecture des fichiers extraits impossible : {e}"))?;
            Ok(Opened {
                backend: Backend::Dir,
                items: found.into_iter().map(|(p, e)| (Source::File(p), e)).collect(),
                _temp: Some(temp),
            })
        }
        "ini" => {
            let entries = list_filter_ini(path)?;
            Ok(Opened {
                backend: Backend::Dir,
                items: entries.into_iter().map(|e| (Source::File(path.to_path_buf()), e)).collect(),
                _temp: None,
            })
        }
        _ => Err(unsupported_format(path)),
    }
}

impl Opened {
    fn write(&mut self, item: usize, dest: &Path) -> Result<(), String> {
        match (&mut self.backend, &self.items[item].0) {
            (Backend::Zip(archive), Source::ZipIndex(i)) => {
                let mut file = archive.by_index(*i).map_err(|e| format!("Archive illisible : {e}"))?;
                let mut target = File::create(dest).map_err(|e| format!("Écriture impossible : {e}"))?;
                io::copy(&mut file, &mut target).map_err(|e| format!("Extraction impossible : {e}"))?;
                Ok(())
            }
            (_, Source::File(src)) => fs::copy(src, dest).map(|_| ()).map_err(|e| format!("Copie impossible : {e}")),
            _ => Err("Archive incohérente.".into()),
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Manifeste, inspection, installation
// ---------------------------------------------------------------------------------------------

fn content_dir(ac: &Path, kind: &str) -> PathBuf {
    ac.join("content").join(if kind == "car" { "cars" } else { "tracks" })
}

/// Où copier un mod : son dossier dans `content`, la racine du jeu pour Custom Shaders Patch et les mods de ciel,
/// ou le dossier des filtres d'image.
fn dest_dir(ac: &Path, d: &Detected) -> PathBuf {
    match d.kind {
        "csp" | "weather" => ac.to_path_buf(),
        "filter" => ac.join("system").join("cfg").join("ppfilters"),
        _ => content_dir(ac, d.kind).join(&d.id),
    }
}

/// Dossiers du jeu (ex. `content/weather/3_clear`) où un mod de ciel va **écraser** un fichier déjà présent.
/// Ajouter un fichier dans un dossier existant (comme le fait Sol avec `preview.jpg`) n'écrase rien et n'est pas compté.
fn overwritten_dirs(ac: &Path, d: &Detected) -> Vec<String> {
    let mut dirs: Vec<String> = vec![];
    for file in d.files.iter().filter(|f| f.iter().fold(ac.to_path_buf(), |acc, c| acc.join(c)).is_file()) {
        let dir = file[..file.len() - 1].join("/");
        if !dirs.contains(&dir) {
            dirs.push(dir);
        }
    }
    dirs
}

/// Dossier où sont copiés les fichiers de ciel qu'une installation remplace (dans les données de Nexora-Corsa).
fn weather_backup_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let dir = crate::config::data_dir(app)?.join("weather-backup").join(secs.to_string());
    fs::create_dir_all(&dir).map_err(|e| format!("Création de la sauvegarde impossible : {e}"))?;
    Ok(dir)
}

/// Un contenu de même identifiant est-il déjà en place ?
fn is_present(ac: &Path, d: &Detected) -> bool {
    match d.kind {
        "csp" => crate::csp::status(ac).installed,
        "filter" => dest_dir(ac, d).join(format!("{}.ini", d.id)).is_file(),
        // Un mod de ciel est « déjà présent » seulement s'il écraserait un fichier existant.
        "weather" => !overwritten_dirs(ac, d).is_empty(),
        _ => dest_dir(ac, d).exists(),
    }
}

/// Extensions d'archives que l'installeur sait lire.
const ARCHIVE_EXTENSIONS: [&str; 3] = ["zip", "7z", "rar"];

/// Archive qui n'en contient qu'une autre, accompagnée tout au plus de fichiers d'information (ex. « changelog.txt »).
fn nested_archive(entries: &[Entry]) -> Option<Vec<String>> {
    let files: Vec<&Entry> = entries.iter().filter(|e| !e.is_dir).collect();
    let is_archive = |e: &&Entry| e.comps.last().is_some_and(|n| ARCHIVE_EXTENSIONS.contains(&extension(Path::new(n)).as_str()));
    let is_info = |e: &&Entry| e.comps.last().is_some_and(|n| ["txt", "md", "nfo", "url", "html", "png", "jpg", "jpeg"].contains(&extension(Path::new(n)).as_str()));
    let archives: Vec<&&Entry> = files.iter().filter(|e| is_archive(e)).collect();
    if archives.len() == 1 && files.iter().filter(|e| !is_archive(e)).all(is_info) {
        Some(archives[0].comps.clone())
    } else {
        None
    }
}

/// Archive réellement à installer, avec son dossier temporaire (supprimé à la fin).
struct Unwrapped {
    path: PathBuf,
    _temp: Option<TempDir>,
}

/// Beaucoup de téléchargements sont un zip qui contient le vrai zip : si l'archive donnée n'est pas reconnue mais n'en contient qu'une autre, on ouvre celle de l'intérieur.
fn unwrap_nested(app: &AppHandle, outer: &Path) -> Result<Unwrapped, String> {
    let as_is = || Unwrapped { path: outer.to_path_buf(), _temp: None };
    if extension(outer) == "ini" {
        return Ok(as_is());
    }
    let entries = list_archive(outer)?;
    if detect(&entries, outer).is_ok() {
        return Ok(as_is());
    }
    let Some(inner) = nested_archive(&entries) else { return Ok(as_is()) };

    let base = crate::config::data_dir(app)?.join("extract");
    fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    let unique = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let dir = base.join(format!("nested-{}-{unique}", std::process::id()));
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let temp = TempDir(dir.clone());
    let mut opened = open_for_install(app, outer)?;
    let index = (0..opened.items.len()).find(|&i| opened.items[i].1.comps == inner).ok_or("Archive intérieure introuvable.")?;
    let target = dir.join(inner.last().cloned().unwrap_or_default());
    opened.write(index, &target)?;
    Ok(Unwrapped { path: target, _temp: Some(temp) })
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

fn inspect(app: &AppHandle, path: &str) -> Result<Vec<ModInfo>, String> {
    let ac = crate::config::require_ac(app)?;
    let outer = PathBuf::from(path);
    let unwrapped = unwrap_nested(app, &outer)?;
    let p = unwrapped.path.clone();
    let managed = load_manifest(app);
    Ok(detect(&list_archive(&p)?, &p)?
        .into_iter()
        .map(|d| {
            let exists = is_present(&ac, &d);
            let is_managed = managed.iter().any(|m| m.kind == d.kind && m.id == d.id);
            let replaces = if d.kind == "weather" { overwritten_dirs(&ac, &d) } else { vec![] };
            ModInfo { kind: d.kind.into(), id: d.id, exists, managed: is_managed, replaces, backup: None }
        })
        .collect())
}

fn install(app: &AppHandle, path: &str, overwrite: bool) -> Result<Vec<ModInfo>, String> {
    let ac = crate::config::require_ac(app)?;
    let outer = PathBuf::from(path);
    let unwrapped = unwrap_nested(app, &outer)?;
    let p = unwrapped.path.clone();
    let mut opened = open_for_install(app, &p)?;
    let entries: Vec<&Entry> = opened.items.iter().map(|(_, e)| e).collect();
    let detected = {
        let owned: Vec<Entry> = entries.iter().map(|e| Entry { comps: e.comps.clone(), is_dir: e.is_dir }).collect();
        detect(&owned, &p)?
    };
    let mut manifest = load_manifest(app);

    for d in &detected {
        if is_present(&ac, d) && !overwrite {
            return Err(format!("« {} » est déjà installé : confirme le remplacement pour continuer.", d.id));
        }
    }

    let mut results = vec![];
    for d in &detected {
        let dest = dest_dir(&ac, d);
        let existed = is_present(&ac, d);
        // Mise à jour de Custom Shaders Patch : on garde l'ancien chargeur au cas où la nouvelle version poserait problème.
        if d.kind == "csp" && ac.join("dwrite.dll").is_file() {
            let _ = fs::copy(ac.join("dwrite.dll"), ac.join("dwrite.dll.nexora-bak"));
        }
        // Un filtre d'image est un simple fichier : on le copie tel quel dans le dossier des filtres.
        if d.kind == "filter" {
            let index = (0..opened.items.len())
                .find(|&i| opened.items[i].1.comps == d.root)
                .ok_or_else(|| format!("Filtre « {} » introuvable dans l'archive.", d.id))?;
            fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
            let file_name = d.root.last().cloned().unwrap_or_default();
            opened.write(index, &dest.join(&file_name)).map_err(|e| format!("{file_name} : {e}"))?;
            results.push(ModInfo { kind: d.kind.into(), id: d.id.clone(), exists: true, managed: false, replaces: vec![], backup: None });
            continue;
        }
        let mut backup_root: Option<PathBuf> = None;
        for i in 0..opened.items.len() {
            let (comps, is_dir) = {
                let e = &opened.items[i].1;
                (e.comps.clone(), e.is_dir)
            };
            if !comps.starts_with(&d.root) {
                continue;
            }
            // Mod de ciel : seuls les dossiers de météo sont installés, le reste de l'archive est ignoré.
            if d.kind == "weather" && !is_weather_path(&comps[d.root.len()..]) {
                continue;
            }
            let rel: PathBuf = comps[d.root.len()..].iter().collect();
            if rel.as_os_str().is_empty() {
                continue;
            }
            let out = dest.join(&rel);
            if is_dir {
                fs::create_dir_all(&out).map_err(|e| e.to_string())?;
                continue;
            }
            if let Some(parent) = out.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            // Un mod de ciel remplace parfois les réglages météo d'origine : on garde d'abord une copie de chaque fichier écrasé.
            if d.kind == "weather" && out.is_file() {
                let root = match &backup_root {
                    Some(r) => r.clone(),
                    None => {
                        let r = weather_backup_dir(app)?;
                        backup_root = Some(r.clone());
                        r
                    }
                };
                let saved = root.join(&rel);
                if let Some(parent) = saved.parent() {
                    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                }
                fs::copy(&out, &saved).map_err(|e| format!("Sauvegarde de {} impossible : {e}", rel.display()))?;
            }
            opened.write(i, &out).map_err(|e| format!("{} : {e}", rel.display()))?;
        }
        let entry = InstalledMod { kind: d.kind.into(), id: d.id.clone() };
        // On ne s'approprie pas un contenu préexistant (jeu d'origine ou autre outil) : il reste non désinstallable.
        // Custom Shaders Patch n'est jamais suivi : le retirer demande de supprimer des fichiers à la racine du jeu.
        if !matches!(d.kind, "csp" | "weather" | "filter") && !existed && !manifest.contains(&entry) {
            manifest.push(entry);
        }
        let managed = manifest.iter().any(|m| m.kind == d.kind && m.id == d.id);
        results.push(ModInfo {
            kind: d.kind.into(),
            id: d.id.clone(),
            exists: true,
            managed,
            replaces: vec![],
            backup: backup_root.map(|r| r.to_string_lossy().into_owned()),
        });
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

    fn make_zip(name: &str, files: &[&str]) -> PathBuf {
        let path = std::env::temp_dir().join(name);
        let mut w = zip::ZipWriter::new(File::create(&path).unwrap());
        for f in files {
            w.start_file(*f, zip::write::SimpleFileOptions::default()).unwrap();
            w.write_all(b"{}").unwrap();
        }
        w.finish().unwrap();
        path
    }

    fn detect_zip(name: &str, files: &[&str]) -> Result<Vec<Detected>, String> {
        let p = make_zip(name, files);
        detect(&list_archive(&p)?, &p)
    }

    #[test]
    fn detects_prefixed_and_bare_mods() {
        let d = detect_zip(
            "nexora_test_a.zip",
            &["content/cars/my_car/ui/ui_car.json", "content/cars/my_car/data.acd", "my_track/ui/ui_track.json"],
        )
        .unwrap();
        assert_eq!(d.len(), 2);
        assert!(d.iter().any(|m| m.kind == "car" && m.id == "my_car"));
        assert!(d.iter().any(|m| m.kind == "track" && m.id == "my_track"));
    }

    #[test]
    fn bare_archive_uses_file_name_and_layouts_work() {
        let d = detect_zip("nexora_bare.zip", &["ui/layout_a/ui_track.json", "models.ini"]).unwrap();
        assert_eq!(d.len(), 1);
        assert_eq!((d[0].kind, d[0].id.as_str()), ("track", "nexora_bare"));
        assert!(d[0].root.is_empty());
    }

    #[test]
    fn recognises_a_csp_archive_with_or_without_a_folder() {
        for (name, files) in [
            ("nexora_csp_a.zip", vec!["dwrite.dll", "extension/config/a.ini", "extension/lua/b.lua"]),
            ("nexora_csp_b.zip", vec!["assettocorsa/dwrite.dll", "assettocorsa/extension/config/a.ini"]),
        ] {
            let d = detect_zip(name, &files).unwrap();
            assert_eq!(d.len(), 1);
            assert_eq!((d[0].kind, d[0].id.as_str()), ("csp", "custom-shaders-patch"));
        }
        assert_eq!(detect_zip("nexora_csp_b2.zip", &["assettocorsa/dwrite.dll", "assettocorsa/extension/x.ini"]).unwrap()[0].root, vec!["assettocorsa"]);
    }

    #[test]
    fn finds_the_archive_wrapped_inside_another() {
        let e = |p: &str| Entry { comps: components(Path::new(p)), is_dir: false };
        let wrapped = [e("changelog.txt"), e("lights-patch-v030-preview132-full.zip")];
        assert_eq!(nested_archive(&wrapped), Some(vec!["lights-patch-v030-preview132-full.zip".to_string()]));
        // un mod ordinaire avec un zip parmi d'autres fichiers n'est pas « emballé »
        assert!(nested_archive(&[e("car/data.acd"), e("car/skins.zip")]).is_none());
        assert!(nested_archive(&[e("a.zip"), e("b.zip")]).is_none());
        assert!(nested_archive(&[e("readme.txt")]).is_none());
    }

    #[test]
    fn a_lone_dwrite_dll_is_not_csp() {
        // Un autre outil (ReShade…) fournit aussi un dwrite.dll : sans dossier « extension » on ne l'installe pas.
        assert!(detect_zip("nexora_dll_only.zip", &["dwrite.dll", "readme.txt"]).is_err());
    }

    #[test]
    fn recognises_a_sky_mod_and_ignores_everything_outside_weather_folders() {
        let d = detect_zip(
            "nexora_sky.zip",
            &[
                "Sol/content/weather/sol_01_clear/weather.ini",
                "Sol/extension/weather-controllers/sol/controller.lua",
                "Sol/extension/weather/sol/manifest.ini",
                "Sol/apps/python/sol_control/app.py",
                "Sol/readme.txt",
            ],
        )
        .unwrap();
        assert_eq!(d.len(), 1);
        // le contrôleur donne son nom au mod : « sol », pas le premier réglage météo rencontré
        assert_eq!((d[0].kind, d[0].id.as_str(), d[0].root.as_slice()), ("weather", "sol", &["Sol".to_string()][..]));
        let rel = |s: &str| s.split('/').map(String::from).collect::<Vec<_>>();
        assert!(is_weather_path(&rel("content/weather/sol_01_clear/weather.ini")));
        assert!(is_weather_path(&rel("Extension/Weather-Controllers/sol/controller.lua")));
        assert!(is_weather_path(&rel("extension/weather/sol/manifest.ini")));
        // hors liste : jamais installé, même s'il est dans l'archive
        assert!(!is_weather_path(&rel("apps/python/sol_control/app.py")));
        assert!(!is_weather_path(&rel("dwrite.dll")));
        assert!(!is_weather_path(&rel("extension/config/general.ini")));
        assert!(!is_weather_path(&rel("content/weather")));
        assert!(!is_weather_path(&rel("content/cars/x/data.acd")));
    }

    #[test]
    fn a_sky_mod_gets_the_same_name_whatever_the_file_order() {
        // Cas réel : Sol remplace des réglages météo d'origine. À l'aperçu l'archive est lue dans son ordre ;
        // à l'installation, après extraction, dans l'ordre alphabétique (où « content » passe avant « extension »).
        let archive_order = [
            "Sol/extension/weather-controllers/sol/controller.lua",
            "Sol/extension/weather/sol/manifest.ini",
            "Sol/content/weather/sol_01_clear/weather.ini",
            "Sol/content/weather/1_heavy_fog/weather.ini",
            "Sol/content/weather/3_clear/weather.ini",
        ];
        let mut extracted_order = archive_order.to_vec();
        extracted_order.sort();
        let entries = |files: &[&str]| -> Vec<Entry> {
            files.iter().map(|f| Entry { comps: f.split('/').map(String::from).collect(), is_dir: false }).collect()
        };
        let a = detect_weather(&entries(&archive_order)).unwrap();
        let b = detect_weather(&entries(&extracted_order)).unwrap();
        assert_eq!(a.id, "sol");
        assert_eq!(b.id, "sol");
        assert_eq!(a.root, b.root);
        let sorted = |w: &WeatherMod| {
            let mut t: Vec<String> = w.targets.iter().map(|t| t.join("/")).collect();
            t.sort();
            t
        };
        assert_eq!(sorted(&a), sorted(&b));
        // les réglages d'origine remplacés figurent bien parmi les dossiers écrits (pour le signaler à l'utilisateur)
        assert!(sorted(&a).contains(&"content/weather/1_heavy_fog".to_string()));
        assert_eq!(sorted(&a).len(), 5);

        // sans contrôleur ni style : un réglage qui n'est pas d'origine est préféré aux réglages d'origine
        let only_content = detect_weather(&entries(&["x/content/weather/1_heavy_fog/w.ini", "x/content/weather/my_storm/w.ini"])).unwrap();
        assert_eq!(only_content.id, "my_storm");
        // uniquement des réglages d'origine : le premier par ordre alphabétique, quel que soit l'ordre des fichiers
        let stock_a = detect_weather(&entries(&["content/weather/3_clear/w.ini", "content/weather/1_heavy_fog/w.ini"])).unwrap();
        let stock_b = detect_weather(&entries(&["content/weather/1_heavy_fog/w.ini", "content/weather/3_clear/w.ini"])).unwrap();
        assert_eq!((stock_a.id.as_str(), stock_b.id.as_str()), ("1_heavy_fog", "1_heavy_fog"));
    }

    #[test]
    fn only_real_overwrites_count_as_replacements() {
        let ac = std::env::temp_dir().join("nexora_overwrite_test");
        let _ = fs::remove_dir_all(&ac);
        fs::create_dir_all(ac.join("content").join("weather").join("3_clear")).unwrap();
        fs::write(ac.join("content").join("weather").join("3_clear").join("weather.ini"), "stock").unwrap();
        let path = |s: &str| s.split('/').map(String::from).collect::<Vec<_>>();
        let sol = |files: &[&str]| Detected {
            kind: "weather",
            id: "sol".into(),
            root: vec![],
            files: files.iter().map(|f| path(f)).collect(),
        };
        // Sol ajoute preview.jpg à un dossier d'origine : le dossier existe, mais rien n'est écrasé
        let adds = sol(&["content/weather/3_clear/preview.jpg", "content/weather/sol_01_clear/weather.ini"]);
        assert!(overwritten_dirs(&ac, &adds).is_empty());
        assert!(!is_present(&ac, &adds));
        // un fichier déjà là serait écrasé : on le signale (une seule fois par dossier) et la confirmation est demandée
        let replaces = sol(&["content/weather/3_clear/weather.ini", "content/weather/3_clear/preview.jpg"]);
        assert_eq!(overwritten_dirs(&ac, &replaces), vec!["content/weather/3_clear".to_string()]);
        assert!(is_present(&ac, &replaces));
    }

    #[test]
    fn recognises_image_filters_in_archives_and_alone() {
        let d = detect_zip("nexora_filters.zip", &["ppfilters/cinematic.ini", "pack/ppfilters/warm.ini", "ppfilters/notes.txt"]).unwrap();
        assert_eq!(d.len(), 2);
        assert!(d.iter().all(|m| m.kind == "filter"));
        assert!(d.iter().any(|m| m.id == "cinematic") && d.iter().any(|m| m.id == "warm"));

        let dir = std::env::temp_dir().join("nexora_filter_ini");
        fs::create_dir_all(&dir).unwrap();
        let ok = dir.join("moody.ini");
        fs::write(&ok, "[YEBIS]\r\nENABLED=1\r\n").unwrap();
        let detected = detect(&list_archive(&ok).unwrap(), &ok).unwrap();
        assert_eq!((detected[0].kind, detected[0].id.as_str()), ("filter", "moody"));
        let other = dir.join("random.ini");
        fs::write(&other, "[SOMETHING]\r\nX=1\r\n").unwrap();
        assert!(list_archive(&other).is_err());
    }

    #[test]
    fn csp_wins_over_sky_detection() {
        // CSP contient lui-même extension/weather : il doit rester reconnu comme Custom Shaders Patch.
        let d = detect_zip("nexora_csp_sky.zip", &["dwrite.dll", "extension/weather/base/manifest.ini", "extension/config/a.ini"]).unwrap();
        assert_eq!(d[0].kind, "csp");
    }

    #[test]
    fn rejects_unrelated_archives() {
        assert!(detect_zip("nexora_none.zip", &["readme.txt"]).is_err());
    }

    #[test]
    fn rejects_unknown_formats() {
        let err = list_archive(Path::new("mod.tar.gz")).err().unwrap();
        assert!(err.contains(".gz"));
    }

    #[test]
    fn entry_paths_cannot_escape() {
        assert!(clean_entry_path("../evil.txt").is_none());
        assert!(clean_entry_path("a/../../evil.txt").is_none());
        assert!(clean_entry_path("..\\evil.txt").is_none());
        assert!(clean_entry_path("/abs/evil.txt").is_none());
        assert_eq!(clean_entry_path("my_car\\ui\\ui_car.json").unwrap(), vec!["my_car", "ui", "ui_car.json"]);
    }

    #[test]
    fn lists_and_extracts_a_7z_mod() {
        let base = std::env::temp_dir().join("nexora_7z_test");
        let _ = fs::remove_dir_all(&base);
        let car = base.join("src").join("my_7z_car");
        fs::create_dir_all(car.join("ui")).unwrap();
        fs::write(car.join("ui").join("ui_car.json"), "{}").unwrap();
        fs::write(car.join("data.acd"), "x").unwrap();
        let archive = base.join("my_7z_car.7z");
        sevenz_rust2::compress_to_path(base.join("src"), &archive).unwrap();

        let entries = list_archive(&archive).unwrap();
        let detected = detect(&entries, &archive).unwrap();
        assert_eq!(detected.len(), 1);
        assert_eq!((detected[0].kind, detected[0].id.as_str()), ("car", "my_7z_car"));

        let out = base.join("out");
        extract_7z(&archive, &out).unwrap();
        assert!(out.join("my_7z_car").join("data.acd").is_file());
    }

    /// Nécessite un vrai .rar : `NEXORA_RAR_SAMPLE=chemin\vers\archive.rar cargo test --lib rar -- --ignored`
    #[test]
    #[ignore]
    fn lists_and_extracts_a_real_rar() {
        let sample = PathBuf::from(std::env::var("NEXORA_RAR_SAMPLE").expect("NEXORA_RAR_SAMPLE non défini"));
        let entries = list_rar(&sample).unwrap();
        assert!(!entries.is_empty());
        let out = std::env::temp_dir().join("nexora_rar_test_out");
        let _ = fs::remove_dir_all(&out);
        fs::create_dir_all(&out).unwrap();
        extract_rar(&sample, &out).unwrap();
        let mut found = vec![];
        walk(&out, &out, &mut found).unwrap();
        assert!(found.iter().any(|(_, e)| !e.is_dir), "aucun fichier extrait");
        let _ = fs::remove_dir_all(&out);
    }
}

#[derive(Serialize)]
pub struct RecentDownload {
    pub path: String,
    pub name: String,
    pub size_mb: f64,
    pub age_min: u64,
}

/// Archives récemment téléchargées (dernière heure), les plus récentes d'abord.
/// Permet d'installer un mod pris sur le Garage sans chercher le fichier.
#[tauri::command]
pub fn recent_downloads() -> Vec<RecentDownload> {
    const WINDOW_SECS: u64 = 3600;
    let Some(dir) = dirs::download_dir() else { return vec![] };
    let now = std::time::SystemTime::now();
    let mut found: Vec<(u64, RecentDownload)> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let path = e.path();
            let ext = extension(&path);
            // Les .ini de Téléchargements sont nombreux : on ne garde que les filtres d'image.
            if !SUPPORTED.contains(&ext.as_str()) && !(ext == "ini" && is_filter_ini(&path)) {
                return None;
            }
            let meta = e.metadata().ok()?;
            let age = now.duration_since(meta.modified().ok()?).ok()?.as_secs();
            (meta.is_file() && age <= WINDOW_SECS).then(|| {
                (
                    age,
                    RecentDownload {
                        name: e.file_name().to_string_lossy().into_owned(),
                        path: path.to_string_lossy().into_owned(),
                        size_mb: (meta.len() as f64 / 1_048_576.0 * 10.0).round() / 10.0,
                        age_min: age / 60,
                    },
                )
            })
        })
        .collect();
    found.sort_by_key(|(age, _)| *age);
    found.into_iter().take(5).map(|(_, d)| d).collect()
}

#[tauri::command]
pub fn list_mods(app: AppHandle) -> Vec<InstalledMod> {
    load_manifest(&app)
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
pub async fn uninstall_mod(app: AppHandle, kind: String, id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || uninstall(&app, &kind, &id))
        .await
        .map_err(|e| e.to_string())?
}
