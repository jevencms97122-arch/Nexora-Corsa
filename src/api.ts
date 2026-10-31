import { invoke } from "@tauri-apps/api/core";

export interface AppConfig {
  ac_path: string | null;
  player_name: string;
}
export interface Car {
  id: string;
  name: string;
  brand: string;
  skins: string[];
}
export interface TrackLayout {
  id: string;
  name: string;
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

export interface ModInfo {
  kind: "car" | "track";
  id: string;
  exists: boolean;
  managed: boolean;
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
  carPreview: (car: string, skin: string) => invoke<string | null>("car_preview", { car, skin }),
  trackPreview: (track: string, layout: string) =>
    invoke<string | null>("track_preview", { track, layout }),
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
