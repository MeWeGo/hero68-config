// Music rhythm: our own replacement for AULA's HEROMusicServe. Audio comes from AudioAnalyser,
// frames go to the keyboard's live lighting stream (HeroKeyboard.streamKeys / streamAll).

import { AudioAnalyser } from "./audio.js";

const FPS = 30;
const COLS = 15;
const ROWS = 5;

export const EFFECTS = [
  { id: "off", name: "Off" },
  { id: "spectrum", name: "Spectrum bars" },
  { id: "wave", name: "Sound wave" },
  { id: "pulse", name: "Bass pulse" },
  { id: "sparkle", name: "Sparkle" },
];

export const PALETTES = [
  { id: "classic", name: "Green → red" },
  { id: "rainbow", name: "Rainbow" },
  { id: "solid", name: "Single colour" },
];

const hsv = (h, s, v) => {
  const f = (n) => {
    const k = (n + h * 6) % 6;
    return Math.round(255 * v * (1 - s * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return { r: f(5), g: f(3), b: f(1) };
};
const scale = (c, v) => ({ r: Math.round(c.r * v), g: Math.round(c.g * v), b: Math.round(c.b * v) });
// fewer distinct colours = fewer groups = fewer packets per frame
const quant = (c) => ({ r: c.r & 0xf0, g: c.g & 0xf0, b: c.b & 0xf0 });

export class RhythmEngine {
  constructor(keys) {
    // keys: [{pos, x, y, w, h}] -> column/row grid
    const cx = keys.map((k) => k.x + k.w / 2), cy = keys.map((k) => k.y + k.h / 2);
    const [x0, x1] = [Math.min(...cx), Math.max(...cx)];
    const [y0, y1] = [Math.min(...cy), Math.max(...cy)];
    this.keys = keys.map((k, i) => ({
      pos: k.pos,
      col: Math.min(COLS - 1, Math.floor(((cx[i] - x0) / (x1 - x0 + 1)) * COLS)),
      row: Math.min(ROWS - 1, Math.floor(((cy[i] - y0) / (y1 - y0 + 1)) * ROWS)), // 0 = top
    }));
    this.audio = new AudioAnalyser();
    this.kb = null;
    this.effect = "off";
    this.settings = { gain: 10, smooth: 4, palette: "classic", color: { r: 0, g: 220, b: 255 } };
    this.onFrame = () => {};
    this._timer = null;
    this._levels = new Array(COLS).fill(0);
    this._wave = new Array(COLS).fill(0);
    this._hue = 0;
    this._sparks = new Map();
    this._tick = 0;
  }

  get running() {
    return this.effect !== "off";
  }

  async setEffect(id) {
    if (id === "off") return this.stop();
    if (!this.audio.running) await this.audio.start();
    this.effect = id;
    this._timer ??= setInterval(() => this._frame(), 1000 / FPS);
  }

  stop() {
    clearInterval(this._timer);
    this._timer = null;
    this.effect = "off";
    this.audio.stop();
    this.onFrame(null);
    // the keyboard returns to its saved lighting by itself ~3 s after the last frame
  }

  _color(level, col, row) {
    const s = this.settings;
    if (s.palette === "rainbow") return hsv((col / COLS + this._hue) % 1, 1, 1);
    if (s.palette === "solid") return s.color;
    // classic VU colours by height: green, green, yellow, orange, red
    return [{ r: 0, g: 255, b: 0 }, { r: 0, g: 255, b: 0 }, { r: 255, g: 220, b: 0 }, { r: 255, g: 110, b: 0 }, { r: 255, g: 0, b: 0 }][
      ROWS - 1 - row
    ];
  }

  _frame() {
    const s = this.settings;
    const gain = 0.25 + s.gain / 10; // slider 0..20 -> 0.25x..2.25x
    const decay = 0.5 + s.smooth * 0.06; // slider 0..8 -> fast..slow fall-off
    const raw = this.audio.bands(COLS, gain);
    this._levels = raw.map((v, i) => Math.max(v, this._levels[i] * decay));
    this._hue = (this._hue + 0.003) % 1;
    this._tick++;

    const frame = new Map();
    const L = this._levels;
    if (this.effect === "spectrum") {
      for (const k of this.keys) {
        const lit = Math.round(L[k.col] * ROWS);
        if (ROWS - k.row <= lit) frame.set(k.pos, quant(this._color(L[k.col], k.col, k.row)));
      }
    } else if (this.effect === "wave") {
      // loudness scrolls left -> right, one column every other frame
      if (this._tick % 2 === 0) this._wave = [Math.max(...L.slice(0, 5)), ...this._wave.slice(0, -1)];
      for (const k of this.keys) {
        const v = this._wave[k.col];
        if (v > 0.08) frame.set(k.pos, quant(scale(this._color(v, k.col, ROWS - 1 - Math.round(v * (ROWS - 1))), v)));
      }
    } else if (this.effect === "pulse") {
      const bass = Math.min(1, (L[0] + L[1] + L[2]) / 3);
      const v = bass * bass;
      const c = s.palette === "solid" ? s.color : s.palette === "rainbow" ? hsv(this._hue, 1, 1) : hsv(0.33 - bass * 0.33, 1, 1);
      const out = quant(scale(c, v));
      this.kb?.streamAll(out);
      this.onFrame({ all: out });
      return;
    } else if (this.effect === "sparkle") {
      // random keys flash on transients and fade out
      const energy = L.reduce((a, b) => a + b, 0) / COLS;
      const spawn = Math.floor(energy * energy * 10);
      for (let i = 0; i < spawn; i++) {
        const k = this.keys[(Math.random() * this.keys.length) | 0];
        this._sparks.set(k.pos, { v: 1, c: this._color(1, k.col, (Math.random() * ROWS) | 0) });
      }
      for (const [pos, sp] of this._sparks) {
        sp.v *= decay;
        if (sp.v < 0.08) this._sparks.delete(pos);
        else frame.set(pos, quant(scale(sp.c, sp.v)));
      }
    }
    this.kb?.streamKeys(frame);
    this.onFrame(frame);
  }
}
