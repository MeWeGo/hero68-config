// AULA HERO 68 HE configuration protocol ("kb_by_v3_wired"), reimplemented over WebHID.
//
// Transport: output/input report id 9 on the vendor collection (usage page 0xFF60), 63-byte payload.
//   [0] command   [1] sub-command / layer   [2] 0   [3] packet count   [4] packet index
//   [5] data length   [6..61] data   [62] checksum = 255 - (9 + sum([0..61])) % 256
// Fetch commands have the high bit set (0x80+); the device answers with the same command byte.
// Write commands are acknowledged by an echo of the command byte.

export const VENDOR_ID = 0x372e;
export const PRODUCT_ID = 0x103e;
export const USAGE_PAGE = 0xff60;
const REPORT_ID = 9;
const LEN = 63;

// polling_level -> Hz, from the configurator's option table.
export const POLLING_RATES = [
  { level: 3, hz: 125 },
  { level: 2, hz: 250 },
  { level: 1, hz: 500 },
  { level: 0, hz: 1000 },
  { level: 6, hz: 2000 },
  { level: 5, hz: 4000 },
  { level: 4, hz: 8000 },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const u16 = (v) => [(v >> 8) & 255, v & 255];
const u32 = (v) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
const rd16 = (b, i) => (b[i] << 8) | b[i + 1];
const rd32 = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

export class HeroKeyboard {
  constructor(device) {
    this.device = device;
    this.waiters = new Set();
    this.lock = Promise.resolve();
    this.precision = 10; // micrometres per device distance unit, refreshed in init()
    this.onUnsolicited = null;
    device.addEventListener("inputreport", (e) => this._onReport(e));
  }

  static async connect({ prompt = false } = {}) {
    let devices = (await navigator.hid.getDevices()).filter(isConfigInterface);
    if (!devices.length && prompt) {
      devices = (
        await navigator.hid.requestDevice({
          filters: [{ vendorId: VENDOR_ID, productId: PRODUCT_ID, usagePage: USAGE_PAGE }],
        })
      ).filter(isConfigInterface);
    }
    if (!devices.length) return null;
    const dev = devices[0];
    if (!dev.opened) await dev.open();
    const kb = new HeroKeyboard(dev);
    await kb.init();
    return kb;
  }

  async init() {
    const rt = (await this.fetch([0x82, 6])).data[0];
    const dist = (await this.fetch([0x82, 8])).data[0];
    this.precision = dist || rt || 10;
  }

  async close() {
    try {
      await this.device.close();
    } catch {}
  }

  // ---- transport ----------------------------------------------------------

  _onReport(e) {
    if (e.reportId !== REPORT_ID) return;
    const bytes = Array.from(new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength));
    for (const w of this.waiters) {
      if (w.match(bytes)) {
        this.waiters.delete(w);
        w.resolve(bytes);
        return;
      }
    }
    this.onUnsolicited?.(bytes);
  }

  _build(header, data) {
    const p = new Array(LEN).fill(0);
    header.forEach((b, i) => (p[i] = b));
    if (p[3] === 0) p[3] = 1; // packet count
    if (data) {
      p[5] = data.length;
      data.forEach((b, i) => (p[6 + i] = b));
    }
    let sum = REPORT_ID;
    for (let i = 0; i < LEN - 1; i++) sum += p[i];
    p[LEN - 1] = 255 - (sum % 256);
    return new Uint8Array(p);
  }

  // Serialised request/response. Resolves with the full 63-byte reply.
  transact(header, data, { timeout = 400, retries = 4 } = {}) {
    const run = async () => {
      const pkt = this._build(header, data);
      const cmd = pkt[0];
      const idx = pkt[4];
      for (let attempt = 0; attempt <= retries; attempt++) {
        const reply = new Promise((resolve) => {
          const w = { match: (b) => b[0] === cmd && b[4] === idx, resolve };
          this.waiters.add(w);
          setTimeout(() => {
            if (this.waiters.delete(w)) resolve(null);
          }, timeout);
        });
        // sendReport never settles if the device drops off the bus mid-write, so bound it too.
        await Promise.race([this.device.sendReport(REPORT_ID, pkt), sleep(timeout)]);
        const r = await reply;
        if (r) return r;
        await sleep(20);
      }
      throw new Error(`No reply to command 0x${cmd.toString(16)}`);
    };
    const p = this.lock.then(run, run);
    this.lock = p.catch(() => {});
    return p;
  }

  // Fetch helper: returns { raw, len, data } where data = payload bytes [6..62).
  // The length byte is not reliable for fixed-size replies (firmware reports 1, sends 2), so keep the whole payload.
  async fetch(header, data) {
    const raw = await this.transact(header, data);
    return { raw, len: raw[5], data: raw.slice(6, LEN - 1) };
  }

  // ---- device info --------------------------------------------------------

  async getUuid() {
    const { data } = await this.fetch([0x82, 1, 0, 1, 0, 6]);
    return data.slice(0, 6).reduce((a, b) => a * 256 + b, 0);
  }

  async getFirmware() {
    const { data } = await this.fetch([0x82, 2, 0, 1, 0, 1]);
    const v = data[1] * 256 + data[0];
    return { raw: v, text: `${data[1].toString(16)}.${data[0].toString(16).padStart(2, "0")}` };
  }

  // ---- basic settings -----------------------------------------------------

  async _getSetting(sub) {
    return (await this.fetch([0x84, sub])).raw.slice(6);
  }

  async _setSetting(sub, bytes) {
    await this.transact([0x04, sub, 0, 1, 0], bytes);
  }

  async getPolling() {
    return (await this._getSetting(23))[0];
  }
  // The keyboard re-enumerates on USB after a polling change (even to the same value), so no ack arrives.
  // Callers should expect a disconnect/reconnect.
  async setPolling(level) {
    await this.transact([0x04, 23, 0, 1, 0], [level], { timeout: 300, retries: 0 }).catch(() => {});
  }

  async getWinLock() {
    return (await this._getSetting(21))[0] === 1;
  }
  async setWinLock(on) {
    await this._setSetting(21, [on ? 1 : 0]);
  }

  async getMacMode() {
    return (await this._getSetting(17))[0] === 1;
  }
  async setMacMode(on) {
    await this._setSetting(17, [on ? 1 : 0]);
  }

  // ---- lighting -----------------------------------------------------------

  _parseLight(d) {
    return { mode: d[0], rainbow: d[1] === 7, r: d[2], g: d[3], b: d[4], bright: d[5], speed: d[6] };
  }
  _lightBytes(l) {
    return [l.mode, l.rainbow ? 7 : 0, l.r, l.g, l.b, l.bright, l.speed];
  }

  async getLight() {
    return this._parseLight(await this._getSetting(1));
  }
  async setLight(l) {
    await this._setSetting(1, this._lightBytes(l));
  }

  async getSideLight() {
    return this._parseLight(await this._getSetting(6));
  }
  async setSideLight(l) {
    // The official app sends length 4 when rainbow is on (colour bytes ignored), 7 otherwise.
    await this.transact([0x04, 6, 0, 1, 0, l.rainbow ? 4 : 7, ...this._lightBytes(l)]);
  }

  async getKeyColors(positions) {
    const out = new Map();
    for (const part of chunk(positions, 11)) {
      const { data, len } = await this.fetch([0x86, 0, 0, 1, 0], part.flatMap(u16));
      for (let i = 0; i + 5 <= Math.max(len, part.length * 5); i += 5) {
        const pos = rd16(data, i);
        if (part.includes(pos)) out.set(pos, { r: data[i + 2], g: data[i + 3], b: data[i + 4] });
      }
    }
    return out;
  }

  async setKeyColors(entries) {
    const bytes = entries.flatMap((e) => [...u16(e.pos), e.r, e.g, e.b]);
    const parts = chunk(bytes, 55);
    for (let i = 0; i < parts.length; i++) {
      await this.transact([0x06, 0, 0, parts.length, i], parts[i]);
    }
  }

  // ---- live lighting stream (music rhythm) ---------------------------------
  // cmd 0x08, captured from AULA's music service. Fire-and-forget, no ack; the board drops back to
  // its saved lighting ~3 s after the last frame, and nothing here is written to flash.
  //   08 02: whole board one colour   data = r, g, b
  //   08 01: colour groups            data = [r, g, b, n, pos x n]...  (keys not listed are dark)

  streamAll({ r, g, b }) {
    return this._stream([[0x08, 2, 0, 1, 0, 3, r, g, b]]);
  }

  // colors: Map(pos -> {r,g,b}); black keys can be left out.
  streamKeys(colors) {
    const groups = new Map();
    for (const [pos, c] of colors) {
      if (!(c.r | c.g | c.b)) continue;
      const key = (c.r << 16) | (c.g << 8) | c.b;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(pos);
    }
    // pack groups into <= 56-byte payloads, splitting a group across packets if needed
    const payloads = [[]];
    for (const [key, positions] of groups) {
      let rest = positions;
      while (rest.length) {
        let cur = payloads[payloads.length - 1];
        if (56 - cur.length < 5) payloads.push((cur = []));
        const take = rest.slice(0, 56 - cur.length - 4);
        cur.push(key >> 16, (key >> 8) & 255, key & 255, take.length, ...take);
        rest = rest.slice(take.length);
      }
    }
    if (!payloads[0].length) return this.streamAll({ r: 0, g: 0, b: 0 });
    return this._stream(payloads.map((d, i) => [0x08, 1, 0, payloads.length, i, d.length, ...d]));
  }

  async _stream(packets) {
    if (this._streaming) return; // drop the frame rather than queue behind a slow one
    this._streaming = true;
    try {
      for (const p of packets) await this.device.sendReport(REPORT_ID, this._build(p));
    } catch {
    } finally {
      this._streaming = false;
    }
  }

  // ---- profiles -----------------------------------------------------------

  async getProfile() {
    return (await this.transact([0x90, 0, 0, 1, 0, 1]))[6];
  }
  async setProfile(idx) {
    await this.transact([0x10, 0, 0, 1, 0], [idx]);
  }

  // ---- keymap -------------------------------------------------------------

  async getKeys(layer, positions) {
    const out = new Map();
    for (const part of chunk(positions, 9)) {
      const { data } = await this.fetch([0x83, layer, 0, 1, 0], part.flatMap(u16));
      for (let i = 0; i < part.length; i++) {
        const pos = rd16(data, i * 6);
        if (pos === part[i]) out.set(pos, rd32(data, i * 6 + 2));
      }
    }
    return out;
  }

  async setKeys(layer, entries) {
    for (const part of chunk(entries, 9)) {
      await this.transact([0x03, layer, 0, 1, 0], part.flatMap((e) => [...u16(e.pos), ...u32(e.value)]));
    }
  }

  async resetLayer(layer) {
    await this.transact([0x11, layer, 0, 1, 0], [1], { timeout: 1000 });
  }

  // ---- hall-effect: actuation & rapid trigger (distances in micrometres) --

  async getActuation(positions) {
    const out = new Map();
    for (const part of chunk(positions, 11)) {
      const { data } = await this.fetch([0x93, 0, 0, 1, 0], part.flatMap(u16));
      for (let i = 0; i < part.length; i++) {
        const o = i * 5;
        const pos = rd16(data, o);
        if (pos === part[i]) out.set(pos, { um: rd16(data, o + 2) * this.precision, custom: data[o + 4] === 1 });
      }
    }
    return out;
  }

  async setActuation(entries) {
    const bytes = entries.flatMap((e) => [...u16(e.pos), ...u16(Math.round(e.um / this.precision)), e.custom ? 1 : 0]);
    for (const part of chunk(bytes, 55)) await this.transact([0x13, 0, 0, 1, 0], part, { timeout: 1000 });
  }

  async getRapidTrigger(positions) {
    const out = new Map();
    for (const part of chunk(positions, 6)) {
      const { data } = await this.fetch([0x99, 0, 0, 1, 0], part.flatMap(u16));
      for (let i = 0; i < part.length; i++) {
        const o = i * 8;
        const pos = rd16(data, o);
        if (pos === part[i])
          out.set(pos, {
            enabled: data[o + 2] === 1,
            releaseUm: rd16(data, o + 3) * this.precision,
            pressUm: rd16(data, o + 5) * this.precision,
            custom: data[o + 7] === 1,
          });
      }
    }
    return out;
  }

  async setRapidTrigger(entries) {
    const bytes = entries.flatMap((e) => [
      ...u16(e.pos),
      e.enabled ? 1 : 0,
      ...u16(Math.round(e.releaseUm / this.precision)),
      ...u16(Math.round(e.pressUm / this.precision)),
      e.custom ? 1 : 0,
    ]);
    for (const part of chunk(bytes, 48)) await this.transact([0x19, 0, 0, 1, 0], part, { timeout: 1000 });
  }
}

function isConfigInterface(d) {
  return (
    d.vendorId === VENDOR_ID &&
    d.productId === PRODUCT_ID &&
    d.collections.some((c) => c.usagePage === USAGE_PAGE)
  );
}
