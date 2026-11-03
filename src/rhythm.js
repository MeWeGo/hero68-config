// Client for AULA's music-rhythm service (HEROMusicServe.exe), the same one the official web page drives.
// The service captures system audio and animates the keyboard itself; we only send it commands over
// a local WebSocket and receive colour frames for a live preview.
//
// Text protocol:   request  "<id>|<command>|<args...>"   reply "<id>|<code>|<data...>" (code 0 = ok)
//   versions                       -> "1.0.2.8"
//   init|USB:<vid>,<pid>,<report id>,<feature len>,<output len>|WIRELESS:NULL|CODE:<uuid hex>
//   typs                           -> "Typs:169,170,...|Current:180"
//   typConfig|<effect>             -> "gain:3|smooth:2|color:ff0000"
//   change|mode|<effect>           switch effect (180 = off)
//   change|<param>|<value>         tweak a parameter of the running effect
// Unsolicited: "status|..." when the service state changes; binary frames of
//   [r, g, b, count, pos x count]... (or a 4-byte [r, g, b, 255] meaning "every key").

export const SERVICE_URL = "ws://localhost:5170";
export const DOWNLOAD_URL = "https://hubx.pro/static/AppDir/HEROMusicServe.exe";
export const OFF = 180;

const COLORS = ["mcolor", "#23fe26", "#ff4949", "#ff7200", "#fff005", "#00d70f", "#ee00f0", "#ff008a", "#00fefe"];
const AUDIO = [
  { prop: "gain", name: "Gain", type: "slider", min: 0, max: 20 },
  { prop: "smooth", name: "Smoothing", type: "slider", min: 0, max: 8 },
  { prop: "color", name: "Palette", type: "color", presets: COLORS },
];

export const EFFECTS = [
  { type: OFF, name: "Off", params: [] },
  { type: 169, name: "Glorious (rock)", params: AUDIO },
  { type: 428, name: "Dynamic spectrum", params: [
    { prop: "colortype", name: "Display mode", type: "select", options: [
      [0, "Green / yellow / red"], [1, "Rainbow"], [2, "Rainbow reversed"], [3, "Spectrum"], [4, "Spectrum cycle"],
      [5, "White"], [6, "Red"], [7, "Orange"], [8, "Yellow"], [9, "Green"], [10, "Blue"], [12, "Dance with the song"],
    ] },
    { prop: "db", name: "Amplitude", type: "slider", min: 20, max: 100 },
  ] },
  { type: 168, name: "Gentle dance (soft)", params: AUDIO },
  { type: 170, name: "Rising clouds (standard)", params: AUDIO },
  { type: 171, name: "Light field (vocal)", params: [] },
  { type: 172, name: "Flowing stream (standard)", params: AUDIO },
  { type: 173, name: "Blooming flowers (passionate)", params: AUDIO },
];

const ERRORS = {
  1: "service could not parse its config", 2: "no effect configured", 4: "could not change gain",
  5: "could not change smoothing", 6: "bad parameter", 7: "no config found", 8: "no audio output device found",
  9: "keyboard not found by the service", 10: "bad parameter", 11: "bad message format",
  12: "service config download failed", 13: "service is already in use by another app",
};

export class RhythmService {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.version = null;
    this.pending = new Map();
    this.nextId = 1;
    this.onChange = () => {}; // connection / state changed
    this.onFrame = () => {}; // Map(pos -> {r,g,b}) or null
    this._retry = null;
  }

  start() {
    if (this.ws) return;
    const ws = new WebSocket(SERVICE_URL);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.onopen = async () => {
      this.connected = true;
      try {
        this.version = (await this.request("versions"))[0];
      } catch {}
      this.onChange();
    };
    ws.onmessage = (e) => (typeof e.data === "string" ? this._onText(e.data) : this.onFrame(parseFrame(e.data)));
    ws.onclose = () => {
      const was = this.connected;
      this.ws = null;
      this.connected = false;
      for (const p of this.pending.values()) p.reject(new Error("Music service disconnected"));
      this.pending.clear();
      if (was) this.onChange();
      this._retry = setTimeout(() => this.start(), 2000); // keep looking for the service
    };
  }

  _onText(msg) {
    const bar = msg.indexOf("|");
    const id = bar > 0 ? msg.slice(0, bar) : msg;
    const p = this.pending.get(id);
    if (!p) {
      if (msg.startsWith("status") || msg.startsWith("static")) this.onChange();
      return;
    }
    this.pending.delete(id);
    clearTimeout(p.timer);
    const [code, ...data] = msg.slice(bar + 1).split("|");
    code === "0" ? p.resolve(data) : p.reject(new Error("Music service: " + (ERRORS[code] ?? `error ${code}`)));
  }

  request(cmd, timeout = 5000) {
    if (!this.connected) return Promise.reject(new Error("Music service is not running"));
    const id = `id_${Date.now()}_${this.nextId++}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Music service did not answer "${cmd}"`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(`${id}|${cmd}`);
    });
  }

  // Tell the service which keyboard to drive (wired, output report 9, 63 + 1 bytes).
  async init({ vendorId, productId, uuid }) {
    const hex = (v) => "0x" + v.toString(16);
    await this.request(`init|USB:${hex(vendorId)},${hex(productId)},0x9,0,64|WIRELESS:NULL|CODE:${uuid.toString(16)}`);
  }

  async getEffects() {
    const kv = parseKv(await this.request("typs"));
    const available = String(kv.Typs ?? "").split(",").map(Number);
    return { available, current: Number(kv.Current ?? OFF) };
  }

  async getParams(type) {
    return type === OFF ? {} : parseKv(await this.request(`typConfig|${type}`));
  }

  // Fire-and-forget stop, usable from beforeunload where we can't await a reply.
  stopNow() {
    if (this.connected) this.ws.send(`id_${Date.now()}_${this.nextId++}|change|mode|${OFF}`);
  }

  setEffect(type) {
    return this.request(`change|mode|${type}`);
  }

  setParam(prop, value) {
    if (prop === "color") value = String(value).replace("#", "");
    return this.request(`change|${prop}|${value}`);
  }
}

function parseKv(parts) {
  const out = {};
  for (const p of parts) {
    const [k, v] = p.split(":");
    if (k) out[k] = v === undefined || isNaN(Number(v)) ? v : Number(v);
  }
  return out;
}

function parseFrame(buf) {
  const b = new Uint8Array(buf);
  if (b.length < 5) return b.length === 4 && b[3] === 255 ? { all: { r: b[0], g: b[1], b: b[2] } } : null;
  const keys = new Map();
  for (let i = 0; i + 4 <= b.length; ) {
    const color = { r: b[i], g: b[i + 1], b: b[i + 2] };
    const end = Math.min(i + 4 + b[i + 3], b.length);
    for (let j = i + 4; j < end; j++) keys.set(b[j], color);
    i = end;
  }
  return keys;
}
