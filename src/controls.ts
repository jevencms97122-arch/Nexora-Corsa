import type { ControlDevice, InputMethod } from "./api";

/** Touches nommées ; les lettres et chiffres sont traités à part (leur code virtuel est celui du caractère). */
const NAMED: [string, number, string][] = [
  ["ArrowUp", 0x26, "Up Arrow"],
  ["ArrowDown", 0x28, "Down Arrow"],
  ["ArrowLeft", 0x25, "Left Arrow"],
  ["ArrowRight", 0x27, "Right Arrow"],
  ["Space", 0x20, "Space"],
  ["Enter", 0x0d, "Enter"],
  ["Tab", 0x09, "Tab"],
  ["Escape", 0x1b, "Escape"],
  ["Backspace", 0x08, "Backspace"],
  ["Delete", 0x2e, "Delete"],
  ["Insert", 0x2d, "Insert"],
  ["Home", 0x24, "Home"],
  ["End", 0x23, "End"],
  ["PageUp", 0x21, "Page Up"],
  ["PageDown", 0x22, "Page Down"],
  ["ShiftLeft", 0xa0, "Shift (Left)"],
  ["ShiftRight", 0xa1, "Shift (Right)"],
  ["ControlLeft", 0xa2, "Control (Left)"],
  ["ControlRight", 0xa3, "Control (Right)"],
  ["AltLeft", 0xa4, "Alt (Left)"],
  ["AltRight", 0xa5, "Alt (Right)"],
  ["Semicolon", 0xba, ";"],
  ["Equal", 0xbb, "="],
  ["Comma", 0xbc, ","],
  ["Minus", 0xbd, "-"],
  ["Period", 0xbe, "."],
  ["Slash", 0xbf, "/"],
  ["Backquote", 0xc0, "`"],
  ["BracketLeft", 0xdb, "["],
  ["Backslash", 0xdc, "\\"],
  ["BracketRight", 0xdd, "]"],
  ["Quote", 0xde, "'"],
  ["NumpadMultiply", 0x6a, "Numpad *"],
  ["NumpadAdd", 0x6b, "Numpad +"],
  ["NumpadSubtract", 0x6d, "Numpad -"],
  ["NumpadDecimal", 0x6e, "Numpad ."],
  ["NumpadDivide", 0x6f, "Numpad /"],
];

export interface KeyBinding {
  /** Code virtuel Windows, comme `0x26`. */
  vk: number;
  /** Nom lisible, repris en commentaire dans le fichier. */
  label: string;
}

/** Touche pressée → code virtuel Windows. `null` pour une touche non gérée. */
export function keyFromEvent(e: KeyboardEvent): KeyBinding | null {
  if (/^F([1-9]|1[0-2])$/.test(e.code)) {
    const n = Number(e.code.slice(1));
    return { vk: 0x6f + n, label: e.code };
  }
  const digit = /^Digit(\d)$/.exec(e.code);
  if (digit) return { vk: 0x30 + Number(digit[1]), label: digit[1] };
  const pad = /^Numpad(\d)$/.exec(e.code);
  if (pad) return { vk: 0x60 + Number(pad[1]), label: `Numpad ${pad[1]}` };
  // Les lettres suivent la disposition du clavier (AZERTY, QWERTY…), comme le fait Windows.
  if (/^[a-zA-Z]$/.test(e.key)) return { vk: e.key.toUpperCase().charCodeAt(0), label: e.key.toUpperCase() };
  const named = NAMED.find(([code]) => code === e.code);
  return named ? { vk: named[1], label: named[2] } : null;
}

export function formatKey(vk: number, label: string): string {
  return `0x${vk.toString(16).toUpperCase().padStart(2, "0")} ; ${label}`;
}

/** Nom lisible d'un code de touche lu dans le fichier (`0x26` → « Flèche haut »). */
export function keyName(raw: string | undefined): string | null {
  if (!raw || raw === "-1") return null;
  const vk = Number.parseInt(raw, raw.toLowerCase().startsWith("0x") ? 16 : 10);
  if (!Number.isFinite(vk)) return raw;
  const fr: Record<number, string> = {
    0x26: "Flèche haut",
    0x28: "Flèche bas",
    0x25: "Flèche gauche",
    0x27: "Flèche droite",
    0x20: "Espace",
    0x0d: "Entrée",
    0x09: "Tab",
    0x1b: "Échap",
    0x08: "Retour arrière",
    0x2e: "Suppr",
    0xa0: "Maj gauche",
    0xa1: "Maj droite",
    0xa2: "Ctrl gauche",
    0xa3: "Ctrl droite",
    0xa4: "Alt gauche",
    0xa5: "Alt droite",
  };
  if (fr[vk]) return fr[vk];
  if ((vk >= 0x30 && vk <= 0x39) || (vk >= 0x41 && vk <= 0x5a)) return String.fromCharCode(vk);
  if (vk >= 0x70 && vk <= 0x7b) return `F${vk - 0x6f}`;
  if (vk >= 0x60 && vk <= 0x69) return `Pavé ${vk - 0x60}`;
  const named = NAMED.find(([, code]) => code === vk);
  return named ? named[2] : `Touche 0x${vk.toString(16).toUpperCase()}`;
}

/** Boutons de la manette Xbox, dans l'ordre standard de l'API Gamepad (indices 0 à 15). */
const PAD_BUTTONS: Record<number, string> = {
  0: "A",
  1: "B",
  2: "X",
  3: "Y",
  4: "LSHOULDER",
  5: "RSHOULDER",
  8: "BACK",
  9: "START",
  12: "DPAD_UP",
  13: "DPAD_DOWN",
  14: "DPAD_LEFT",
  15: "DPAD_RIGHT",
};

export const padButtonFromIndex = (i: number): string | null => PAD_BUTTONS[i] ?? null;

const PAD_LABELS: Record<string, string> = {
  A: "A",
  B: "B",
  X: "X",
  Y: "Y",
  LSHOULDER: "LB",
  RSHOULDER: "RB",
  BACK: "Retour",
  START: "Menu",
  DPAD_UP: "Croix ↑",
  DPAD_DOWN: "Croix ↓",
  DPAD_LEFT: "Croix ←",
  DPAD_RIGHT: "Croix →",
};

export function padName(raw: string | undefined): string | null {
  if (!raw || raw === "-1") return null;
  return PAD_LABELS[raw.toUpperCase()] ?? raw;
}

export type DeviceKind = "wheel" | "xbox" | "pad";

/** Classe un appareil d'après son nom : volant, manette Xbox (XInput) ou autre manette. */
export function deviceKind(name: string): DeviceKind {
  const n = name.toLowerCase();
  if (/wheel|driving force|racing|\bg2[579]\b|\bg92[03]\b|\bg923\b|t300|t150|t248|\bt-?gt|tx\b|ts-xw|thrustmaster|fanatec|simucube|moza|simagic|ferrari|cammus|vrs|heusinkveld|leo bodnar|cs v2|clubsport|podium/.test(n)) return "wheel";
  if (/xbox|x360|xinput|360 controller/.test(n)) return "xbox";
  return "pad";
}

/** Méthodes de conduite pour lesquelles un appareil branché convient. */
export function methodFits(method: InputMethod, devices: ControlDevice[]): boolean {
  const live = devices.filter((d) => d.connected);
  switch (method) {
    case "KEYBOARD":
      return true;
    case "X360":
      return live.some((d) => deviceKind(d.name) === "xbox");
    case "WHEEL":
      return live.some((d) => deviceKind(d.name) === "wheel");
    case "JOYPAD":
      return live.some((d) => deviceKind(d.name) !== "xbox");
  }
}

/** Constructeur et produit contenus dans l'identifiant d'une manette de l'API Gamepad (« … Vendor: 046d Product: c24f »). */
export function gamepadIds(id: string): { vid: number; pid: number } | null {
  const m = /vendor:\s*([0-9a-f]{4}).*product:\s*([0-9a-f]{4})/i.exec(id);
  return m ? { vid: Number.parseInt(m[1], 16), pid: Number.parseInt(m[2], 16) } : null;
}
