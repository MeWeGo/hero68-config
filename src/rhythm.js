// Music rhythm: our own replacement for AULA's HEROMusicServe. Audio comes from AudioAnalyser,
// frames go to the keyboard's live lighting stream (HeroKeyboard.streamKeys / streamAll).
//
// Each effect is a function (engine, analysis) -> Map(pos -> colour) or { all: colour }.
// analysis = { L: smoothed band levels 0..1, raw: this frame's levels, bass, mid, high, energy, beat, beatPower }

import { AudioAnalyser } from "./audio.js";

const FPS = 30;
const COLS = 15;
const ROWS = 5;

export const PALETTES = [
  { id: "classic", name: "Green → red" },
  { id: "rainbow", name: "Rainbow" },
  { id: "solid", name: "Single colour" },
];

const hsv = (h, s, v) => {
  const f = (n) => {
    const k = (n + (((h % 1) + 1) % 1) * 6) % 6;
    return Math.round(255 * v * (1 - s * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return { r: f(5), g: f(3), b: f(1) };
};
const scale = (c, v) => ({ r: Math.round(c.r * v), g: Math.round(c.g * v), b: Math.round(c.b * v) });
const mix = (a, b, t) => ({ r: Math.round(a.r + (b.r - a.r) * t), g: Math.round(a.g + (b.g - a.g) * t), b: Math.round(a.b + (b.b - a.b) * t) });
const brighter = (a, b) => (a.r + a.g + a.b >= b.r + b.g + b.b ? a : b);
// fewer distinct colours = fewer groups = fewer packets per frame
const quant = (c) => ({ r: c.r & 0xf0, g: c.g & 0xf0, b: c.b & 0xf0 });

const RED = { r: 255, g: 0, b: 0 }, ORANGE = { r: 255, g: 90, b: 0 }, YELLOW = { r: 255, g: 210, b: 0 };
const GREEN = { r: 0, g: 255, b: 0 }, WHITE = { r: 255, g: 255, b: 255 };
const VU = [GREEN, GREEN, YELLOW, ORANGE, RED]; // classic meter colours, bottom -> top

// ---- effects -----------------------------------------------------------------

function spectrum(e, a) {
  const out = new Map();
  for (const k of e.keys) {
    const lit = Math.round(a.L[k.col] * ROWS);
    const h = ROWS - k.row; // 1 = bottom row
    if (h <= lit) out.set(k.pos, e.color(k.col / COLS, VU[h - 1]));
  }
  return out;
}

// Rock: kick/snare hits flash the board hot and decay fast, mids drive a low bar meter,
// highs throw white sparks across the top rows.
function rock(e, a) {
  const st = e.state("rock", () => ({ flash: 0, flashColor: RED, sparks: new Map() }));
  if (a.beat) {
    st.flash = Math.min(1, 0.55 + a.beatPower * 0.45);
    st.flashColor = e.settings.palette === "rainbow" ? hsv(Math.random(), 1, 1) : e.settings.palette === "solid" ? e.settings.color : Math.random() < 0.5 ? RED : ORANGE;
  }
  st.flash *= 0.78;
  if (a.high > 0.45 && Math.random() < a.high) {
    const top = e.keys.filter((k) => k.row <= 1);
    for (let i = 0; i < 1 + a.high * 3; i++) st.sparks.set(top[(Math.random() * top.length) | 0].pos, 1);
  }
  const out = new Map();
  for (const k of e.keys) {
    let c = scale(st.flashColor, st.flash);
    const meter = Math.round(a.L[k.col] * 3.2); // mids/bass meter on the bottom three rows
    const h = ROWS - k.row;
    if (h <= meter) c = brighter(c, scale(e.color(k.col / COLS, h === 1 ? RED : h === 2 ? ORANGE : YELLOW), 0.55 + 0.45 * a.energy));
    const sp = st.sparks.get(k.pos);
    if (sp) {
      c = brighter(c, scale(WHITE, sp));
      sp < 0.15 ? st.sparks.delete(k.pos) : st.sparks.set(k.pos, sp * 0.7);
    }
    out.set(k.pos, c);
  }
  return out;
}

// Fire: flames rise from the bottom row, height and flicker driven by the music.
function fire(e, a) {
  const out = new Map();
  for (const k of e.keys) {
    const heat = Math.min(1, a.L[k.col] * 1.2 + (Math.random() - 0.5) * 0.25 * a.energy);
    const h = (ROWS - k.row) / ROWS; // 0.2 bottom .. 1 top
    const t = heat - h + 0.2;
    if (t <= 0) continue;
    const base = e.settings.palette === "classic" ? mix(RED, YELLOW, Math.min(1, t * 1.6)) : e.color(k.col / COLS, RED);
    out.set(k.pos, scale(base, Math.min(1, t * 1.8)));
  }
  return out;
}

// Center VU: loudness spreads out from the middle of the board.
function centerVu(e, a) {
  const out = new Map();
  const reach = Math.min(1, a.energy * 1.25) * (COLS / 2 + 0.5);
  for (const k of e.keys) {
    const d = Math.abs(k.col - (COLS - 1) / 2);
    if (d > reach) continue;
    const t = d / (COLS / 2);
    out.set(k.pos, e.color(k.col / COLS, t < 0.45 ? GREEN : t < 0.75 ? YELLOW : RED));
  }
  return out;
}

// Ripple: every beat drops a ring that expands across the board.
function ripple(e, a) {
  const st = e.state("ripple", () => ({ rings: [] }));
  if (a.beat) {
    const color = e.settings.palette === "solid" ? e.settings.color : hsv(Math.random(), 1, 1);
    st.rings.push({ x: 2 + Math.random() * (COLS - 4), y: 1 + Math.random() * 3, r: 0, color, v: 0.6 + a.beatPower * 0.4 });
  }
  for (const ring of st.rings) ring.r += 0.55;
  st.rings = st.rings.filter((r) => r.r < COLS + 2).slice(-6);
  const out = new Map();
  for (const k of e.keys) {
    let c = null;
    for (const ring of st.rings) {
      const d = Math.hypot(k.col - ring.x, (k.row - ring.y) * 1.6);
      const edge = 1 - Math.abs(d - ring.r) / 1.3;
      if (edge > 0) {
        const v = edge * ring.v * (1 - ring.r / (COLS + 2));
        c = c ? brighter(c, scale(ring.color, v)) : scale(ring.color, v);
      }
    }
    if (c) out.set(k.pos, c);
  }
  return out;
}

// Rainbow flow: a rainbow sweeps the board, faster and brighter the louder it gets.
function rainbowFlow(e, a) {
  const st = e.state("flow", () => ({ t: 0 }));
  st.t += 0.004 + a.energy * 0.03 + (a.beat ? 0.04 : 0);
  const out = new Map();
  const v = 0.15 + 0.85 * Math.min(1, a.energy * 1.3);
  // one hue per column keeps it to ~15 colour groups (3 packets) instead of 68
  for (const k of e.keys) out.set(k.pos, hsv(k.col / COLS - st.t, 1, v));
  return out;
}

function wave(e, a) {
  const st = e.state("wave", () => ({ cols: new Array(COLS).fill(0) }));
  if (e.tick % 2 === 0) st.cols = [Math.max(...a.L.slice(0, 5)), ...st.cols.slice(0, -1)];
  const out = new Map();
  for (const k of e.keys) {
    const v = st.cols[k.col];
    if (v > 0.08) out.set(k.pos, scale(e.color(k.col / COLS, VU[Math.round(v * (ROWS - 1))]), v));
  }
  return out;
}

function pulse(e, a) {
  const v = a.bass * a.bass;
  const s = e.settings;
  const c = s.palette === "solid" ? s.color : s.palette === "rainbow" ? hsv(e.hue, 1, 1) : hsv(0.33 - a.bass * 0.33, 1, 1);
  return { all: scale(c, v) };
}

function sparkle(e, a) {
  const st = e.state("sparkle", () => new Map());
  const spawn = Math.floor(a.energy * a.energy * 10) + (a.beat ? 6 : 0);
  for (let i = 0; i < spawn; i++) {
    const k = e.keys[(Math.random() * e.keys.length) | 0];
    st.set(k.pos, { v: 1, c: e.color(Math.random(), VU[(Math.random() * ROWS) | 0]) });
  }
  const out = new Map();
  for (const [pos, sp] of st) {
    sp.v *= e.decay;
    if (sp.v < 0.08) st.delete(pos);
    else out.set(pos, scale(sp.c, sp.v));
  }
  return out;
}

export const EFFECTS = [
  { id: "off", name: "Off" },
  { id: "rock", name: "Rock", fn: rock },
  { id: "spectrum", name: "Spectrum bars", fn: spectrum },
  { id: "fire", name: "Fire", fn: fire },
  { id: "ripple", name: "Beat ripple", fn: ripple },
  { id: "center", name: "Center VU", fn: centerVu },
  { id: "flow", name: "Rainbow flow", fn: rainbowFlow },
  { id: "wave", name: "Sound wave", fn: wave },
  { id: "pulse", name: "Bass pulse", fn: pulse },
  { id: "sparkle", name: "Sparkle", fn: sparkle },
];

// ---- engine ------------------------------------------------------------------

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
    this.tick = 0;
    this.hue = 0;
    this.decay = 0.74;
    this._timer = null;
    this._levels = new Array(COLS).fill(0);
    this._bassAvg = 0;
    this._lastBeat = 0;
    this._state = {};
  }

  get running() {
    return this.effect !== "off";
  }

  async setEffect(id) {
    if (id === "off") return this.stop();
    if (!this.audio.running) await this.audio.start();
    this.effect = id;
    this._state = {};
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

  // per-effect scratch state, reset when the effect changes
  state(name, init) {
    return (this._state[name] ??= init());
  }

  // palette colour: `fallback` is the classic-palette colour for this spot, x (0..1) picks the rainbow hue
  color(x, fallback) {
    const s = this.settings;
    if (s.palette === "rainbow") return hsv(x + this.hue, 1, 1);
    if (s.palette === "solid") return s.color;
    return fallback;
  }

  _analyse() {
    const s = this.settings;
    const gain = 0.25 + s.gain / 10; // slider 0..20 -> 0.25x..2.25x
    this.decay = 0.5 + s.smooth * 0.06; // slider 0..8 -> fast..slow fall-off
    const raw = this.audio.bands(COLS, gain);
    this._levels = raw.map((v, i) => Math.max(v, this._levels[i] * this.decay));
    const avg = (arr) => arr.reduce((x, y) => x + y, 0) / arr.length;
    const bass = avg(raw.slice(0, 3));

    // beat = bass jumps well above its recent average (with a short cooldown)
    const now = performance.now();
    const beat = bass > 0.25 && bass > this._bassAvg * 1.35 && now - this._lastBeat > 140;
    if (beat) this._lastBeat = now;
    const beatPower = beat ? Math.min(1, (bass - this._bassAvg) / 0.5) : 0;
    this._bassAvg = this._bassAvg * 0.9 + bass * 0.1;

    return {
      L: this._levels,
      raw,
      bass,
      mid: avg(raw.slice(4, 10)),
      high: avg(raw.slice(10)),
      energy: avg(this._levels),
      beat,
      beatPower,
    };
  }

  _frame() {
    this.tick++;
    this.hue = (this.hue + 0.003) % 1;
    const fx = EFFECTS.find((e) => e.id === this.effect);
    if (!fx?.fn) return;
    const out = fx.fn(this, this._analyse());
    if (out instanceof Map) {
      for (const [pos, c] of out) out.set(pos, quant(c));
      this.kb?.streamKeys(out);
    } else {
      out.all = quant(out.all);
      this.kb?.streamAll(out.all);
    }
    this.onFrame(out);
  }
}
