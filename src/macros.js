// Macro storage and encoding. The keyboard can't read macros back, so the list lives in localStorage
// and is re-sent in full whenever it changes or a key gets bound to a macro.
//
// Blob layout (cmd 0x05): for each macro a 4-byte header [offset lo, offset hi, length lo, length hi],
// offsets counted from the blob start; then each macro body: [name length, name utf-8..., events...].
// Event = 4 bytes: [up/down flag | delay bits 16-19, delay bits 8-15, delay bits 0-7, key code],
// where delay is the wait in ms *after* the event.

import MACRO_KEYS from "./data/macrokeys.js";

export const MAX_EVENTS = 150;
const STORE = "macros";

export const MODES = [
  { id: "times", name: "Run N times", type: 1 },
  { id: "hold", name: "Repeat while held", type: 4 },
  { id: "toggle", name: "Run until another key is pressed", type: 2 },
];

export const MOUSE = [
  ["MouseKey0", "Mouse left"],
  ["MouseKey2", "Mouse middle"],
  ["MouseKey1", "Mouse right"],
  ["MouseKey3", "Mouse back"],
  ["MouseKey4", "Mouse forward"],
];

export function isRecordable(code) {
  return code in MACRO_KEYS;
}

export function eventLabel(code) {
  return (
    MOUSE.find(([c]) => c === code)?.[1] ??
    code.replace(/^Key/, "").replace(/^Digit/, "").replace(/^Arrow/, "").replace(/Left$/, " L").replace(/Right$/, " R")
  );
}

export function loadMacros() {
  try {
    return JSON.parse(localStorage.getItem(STORE) || "[]");
  } catch {
    return [];
  }
}

export function saveMacros(list) {
  try {
    localStorage.setItem(STORE, JSON.stringify(list));
  } catch {}
}

// macros: [{ name, events: [{ code, up, delay }] }]
export function encodeMacros(macros) {
  const bodies = macros.map((m) => {
    const name = Array.from(new TextEncoder().encode(m.name)).slice(0, 32);
    const ev = m.events.flatMap((e) => {
      const [value, down, up] = MACRO_KEYS[e.code];
      const d = Math.max(0, Math.min(0xfffff, Math.round(e.delay)));
      return [((e.up ? up : down) & 0xf0) | ((d >> 16) & 0x0f), (d >> 8) & 255, d & 255, value];
    });
    return [name.length, ...name, ...ev];
  });
  let offset = macros.length * 4;
  const header = [];
  for (const b of bodies) {
    header.push(offset & 255, (offset >> 8) & 255, b.length & 255, (b.length >> 8) & 255);
    offset += b.length;
  }
  return [...header, ...bodies.flat()];
}

// Keycode that binds a key to macro #index: 0x03 | mode type | count | index
export function macroKeycode(index, modeId, count = 1) {
  const mode = MODES.find((m) => m.id === modeId) ?? MODES[0];
  return ((3 << 24) | (mode.type << 16) | ((Math.max(1, Math.min(255, count)) & 255) << 8) | (index & 255)) >>> 0;
}

export function describeMacroKeycode(value, macros) {
  if (value >>> 24 !== 3) return null;
  const type = (value >> 16) & 255, count = (value >> 8) & 255, idx = value & 255;
  const name = macros[idx]?.name ?? `#${idx + 1}`;
  return type === 1 ? `▶ ${name} ×${count}` : type === 4 ? `▶ ${name} (hold)` : `▶ ${name} (toggle)`;
}
