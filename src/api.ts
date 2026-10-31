import { invoke } from "@tauri-apps/api/core";

export interface AppConfig {
  ac_path: string | null;
  player_name: string;
  /** Profil d'aides à la conduite ; vide = « gamer ». */
  assists: string;
}

export interface AssistPreset {
  id: "gamer" | "intermediate" | "pro";
  name: string;
  tagline: string;
  ideal_line: boolean;
  auto_shifter: boolean;
  auto_clutch: boolean;
  auto_blip: boolean;
  /** 0 = désactivé, 1 = d'origine, 2 = activé. */
  abs: number;
  traction_control: number;
  stability_control: number;
  fuel_rate: number;
  tyre_wear: number;
}

export interface RecentDownload {
  path: string;
  name: string;
  size_mb: number;
  age_min: number;
}
export type CarOrigin = "base" | "dlc" | "mod";

export interface Car {
  id: string;
  name: string;
  brand: string;
  /** Jeu de base, pack DLC officiel ou mod. */
  origin: CarOrigin;
  /** Nom du pack DLC (vide si ce n'est pas un DLC). */
  pack: string;
  class: string;
  bhp: string;
  weight: string;
  top_speed: string;
  skins: string[];
}
export interface TrackLayout {
  id: string;
  /** Nom complet de la configuration. */
  name: string;
  /** Nom sans la partie commune à toutes les configurations du circuit. */
  label: string;
  country: string;
  length: string;
  pitboxes: string;
}
export interface Track {
  id: string;
  name: string;
  layouts: TrackLayout[];
}

export interface SoloSettings {
  car: string;
  skin: string;
  track: string;
  track_config: string;
  player_name: string;
  ai_count: number;
  ai_level: number;
  weather: string;
  hour: number;
  session: "practice" | "qualify" | "race";
  duration_min: number;
  laps: number;
  ambient_temp: number;
}

export interface JoinSettings {
  ip: string;
  tcp_port: number;
  http_port: number;
  password: string;
  car: string;
  skin: string;
  player_name: string;
}

export interface ServerCar {
  model: string;
  skin: string;
  count: number;
}
export interface ServerSettings {
  name: string;
  password: string;
  admin_password: string;
  track: string;
  track_config: string;
  cars: ServerCar[];
  max_clients: number;
  udp_port: number;
  tcp_port: number;
  http_port: number;
  register_to_lobby: boolean;
  pickup_mode: boolean;
  practice_min: number;
  qualify_min: number;
  race_laps: number;
  race_wait_secs: number;
  weather: string;
  hour: number;
  ambient_temp: number;
  abs: number;
  tc: number;
  stability: boolean;
  autoclutch: boolean;
  damage: number;
  fuel: number;
  tyre_wear: number;
}
export interface ServerStatus {
  running: boolean;
  name: string;
  udp_port: number;
  tcp_port: number;
  http_port: number;
  has_password: boolean;
}

export interface NetworkInfo {
  local_ip: string | null;
  public_ip: string | null;
  upnp: boolean;
  router_ip: string | null;
  cgnat: boolean;
}
export interface PortsResult {
  opened: string[];
  failed: string[];
}

/** Code d'invitation : adresse et ports encodés, sans mot de passe. */
export function makeInvite(ip: string, tcp: number, http: number): string {
  return "NXC-" + btoa(`${ip}:${tcp}:${http}`).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function parseInvite(code: string): { ip: string; tcp_port: number; http_port: number } | null {
  const m = /^NXC-([A-Za-z0-9_-]+)$/.exec(code.trim());
  if (!m) return null;
  try {
    const raw = atob(m[1].replace(/-/g, "+").replace(/_/g, "/"));
    const [ip, tcp, http] = raw.split(":");
    const t = Number(tcp);
    const h = Number(http);
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip) || !(t > 0 && t < 65536) || !(h > 0 && h < 65536)) return null;
    return { ip, tcp_port: t, http_port: h };
  } catch {
    return null;
  }
}

export interface CspStatus {
  installed: boolean;
  version: string | null;
  build: string | null;
}

export interface GraphicsProfile {
  id: "balanced" | "high" | "ultra" | "cinema";
  name: string;
  tagline: string;
  highlights: { label: string; value: string }[];
  /** Les fichiers de l'utilisateur correspondent exactement à ce profil. */
  matches: boolean;
}
export interface GraphicsState {
  csp_installed: boolean;
  profiles: GraphicsProfile[];
  active: GraphicsProfile["id"] | null;
  has_backup: boolean;
}
export interface FilterInfo {
  id: string;
  /** Fourni avec le jeu (sinon : ajouté par l'utilisateur). */
  builtin: boolean;
  active: boolean;
}
export interface WeatherOptions {
  controllers: string[];
  implementations: string[];
  controller: string;
  implementation: string;
  presets: { id: string; builtin: boolean }[];
  csp_installed: boolean;
}
export interface GpuInfo {
  adapters: string[];
  has_discrete: boolean;
  has_integrated: boolean;
  /** Assetto Corsa est réglé sur « Haute performance » dans Windows. */
  forced: boolean;
}

export type InputMethod = "KEYBOARD" | "X360" | "JOYPAD" | "WHEEL";
export interface ControlDevice {
  /** Numéro d'Assetto Corsa (`JOY=`) ; `null` tant que le jeu n'a pas vu l'appareil. */
  index: number | null;
  name: string;
  vid: number | null;
  pid: number | null;
  connected: boolean;
}
export interface Peripheral {
  name: string;
  /** Classe Windows : HIDClass, Keyboard, Mouse, MEDIA, Bluetooth… */
  class: string;
  bus: "usb" | "bluetooth";
}
export interface ControlsState {
  /** Section → clé → valeur de `controls.ini`. */
  values: Record<string, Record<string, string>>;
  /** Autres appareils USB / Bluetooth branchés. */
  peripherals: Peripheral[];
  devices: ControlDevice[];
  has_backup: boolean;
  exists: boolean;
}
export interface ControlChange {
  section: string;
  key: string;
  value: string;
}

export interface CspSetting {
  section: string;
  key: string;
  label: string;
  note: string;
  kind: "bool" | "number" | "choice" | "text";
  value: string;
  default: string;
  min: number | null;
  max: number | null;
  step: number | null;
  /** Fraction affichée en pourcentage (0,5 → 50 %). */
  percent: boolean;
  unit: string;
  options: [string, string][];
  changed: boolean;
}
export interface CspSection {
  id: string;
  title: string;
  settings: CspSetting[];
}
export interface CspModule {
  id: string;
  name: string;
  summary: string;
  description: string;
  enabled: boolean | null;
  settings: number;
  changed: number;
  /** Vide dans la liste des modules ; rempli pour un module ouvert. */
  sections: CspSection[];
}

export interface ModInfo {
  /** "csp" = Custom Shaders Patch (racine du jeu), "weather" = mod de ciel, "filter" = filtre d'image. */
  kind: "car" | "track" | "csp" | "weather" | "filter";
  id: string;
  exists: boolean;
  managed: boolean;
  /** Dossiers déjà présents que l'installation va remplacer (mods de ciel), ex. `content/weather/1_heavy_fog`. */
  replaces: string[];
  /** Où les fichiers remplacés ont été sauvegardés (renseigné après l'installation). */
  backup: string | null;
}
export interface InstalledMod {
  kind: "car" | "track";
  id: string;
}
export interface HistoryEntry {
  ts: number;
  kind: "solo" | "join" | "host";
  car: string;
  track: string;
  detail: string;
  solo: SoloSettings | null;
}

export const api = {
  cspModules: () => invoke<CspModule[]>("csp_modules"),
  cspModule: (id: string) => invoke<CspModule>("csp_module", { id }),
  setCspValues: (id: string, changes: ControlChange[]) => invoke<CspModule>("set_csp_values", { id, changes }),
  resetCspModule: (id: string) => invoke<CspModule>("reset_csp_module", { id }),
  controlsState: () => invoke<ControlsState>("controls_state"),
  setControls: (changes: ControlChange[]) => invoke<ControlsState>("set_controls", { changes }),
  restoreControls: () => invoke<ControlsState>("restore_controls"),
  graphicsState: () => invoke<GraphicsState>("graphics_state"),
  applyGraphicsProfile: (profile: string) => invoke<GraphicsState>("apply_graphics_profile", { profile }),
  restoreGraphics: () => invoke<GraphicsState>("restore_graphics"),
  listFilters: () => invoke<FilterInfo[]>("list_filters"),
  setFilter: (filter: string) => invoke<FilterInfo[]>("set_filter", { filter }),
  weatherOptions: () => invoke<WeatherOptions>("weather_options"),
  setWeather: (controller: string, implementation: string) => invoke<WeatherOptions>("set_weather", { controller, implementation }),
  gpuInfo: () => invoke<GpuInfo>("gpu_info"),
  setGpuPreference: (high: boolean) => invoke<GpuInfo>("set_gpu_preference", { high }),
  assistPresets: () => invoke<AssistPreset[]>("assist_presets"),
  setAssists: (preset: string) => invoke<AppConfig>("set_assists", { preset }),
  cspStatus: () => invoke<CspStatus>("csp_status"),
  uninstallCsp: () => invoke<CspStatus>("uninstall_csp"),
  downloadCsp: (url: string) => invoke<string>("download_csp", { url }),
  cspSource: () => invoke<{ url: string; version: string }>("csp_source"),
  recentDownloads: () => invoke<RecentDownload[]>("recent_downloads"),
  inspectMod: (path: string) => invoke<ModInfo[]>("inspect_mod", { path }),
  installMod: (path: string, overwrite: boolean) => invoke<ModInfo[]>("install_mod", { path, overwrite }),
  listMods: () => invoke<InstalledMod[]>("list_mods"),
  uninstallMod: (kind: string, id: string) => invoke<void>("uninstall_mod", { kind, id }),
  getHistory: () => invoke<HistoryEntry[]>("get_history"),
  clearHistory: () => invoke<void>("clear_history"),
  networkInfo: () => invoke<NetworkInfo>("network_info"),
  openPorts: (tcpPort: number, udpPort: number, httpPort: number) =>
    invoke<PortsResult>("open_ports", { tcpPort, udpPort, httpPort }),
  closePorts: () => invoke<void>("close_ports"),
  getConfig: () => invoke<AppConfig>("get_config"),
  setAcPath: (path: string) => invoke<AppConfig>("set_ac_path", { path }),
  setPlayerName: (name: string) => invoke<AppConfig>("set_player_name", { name }),
  detectGame: () => invoke<string[]>("detect_game"),
  checkGamePath: (path: string) => invoke<void>("check_game_path", { path }),
  listCars: () => invoke<Car[]>("list_cars"),
  listTracks: () => invoke<Track[]>("list_tracks"),
  listWeathers: () => invoke<string[]>("list_weathers"),
  launchSolo: (settings: SoloSettings) => invoke<void>("launch_solo", { settings }),
  joinServer: (settings: JoinSettings) => invoke<void>("join_server", { settings }),
  startServer: (settings: ServerSettings) => invoke<ServerStatus>("start_server", { settings }),
  stopServer: () => invoke<void>("stop_server"),
  serverStatus: () => invoke<ServerStatus>("server_status"),
  serverLog: () => invoke<string[]>("server_log"),
};

export function errorMessage(e: unknown): string {
  return typeof e === "string" ? e : e instanceof Error ? e.message : JSON.stringify(e);
}

export function weatherLabel(id: string): string {
  const label = id.replace(/^\d+_/, "").replace(/_/g, " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function formatHour(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
