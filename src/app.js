import { HeroKeyboard, POLLING_RATES } from "./protocol.js";
import { RhythmEngine, EFFECTS, PALETTES } from "./rhythm.js";
import LAYOUT from "./data/layout68.js";
import KEYCODES from "./data/keycodes.js";
import { MAIN_MODES, SIDE_MODES, MAIN_LIMITS, SIDE_LIMITS } from "./data/lighting.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const BASE = LAYOUT[0].keys;
const POSITIONS = BASE.map((k) => k.pos);
const WASD = [30, 43, 44, 45];

const state = {
  kb: null,
  tab: "performance",
  layer: 0,
  selected: new Set(),
  actuation: new Map(),
  rt: new Map(),
  keymap: [new Map(), new Map(), new Map()],
  colors: new Map(),
  main: null,
  side: null,
};

// ---- keycode names ---------------------------------------------------------

const KEY_NAMES = new Map();
for (const g of KEYCODES) for (const it of g.items) if (!KEY_NAMES.has(Number(it.value))) KEY_NAMES.set(Number(it.value), it.name);
for (const layer of LAYOUT) for (const k of layer.keys) if (!KEY_NAMES.has(Number(k.value))) KEY_NAMES.set(Number(k.value), k.name);

// Firmware function codes used on the factory Fn layer. The official app has no names for these;
// meaning inferred from where they sit (Fn+arrows, Fn+V/B/N, ...).
//   0x08 AA BB CC  lighting: AA 0=on/off 2=mode 3=brightness 4=speed, BB 1=up 2=down, CC 0=main 1=side
//   0x09 00 00 NN  switch to profile NN+1
function fnName(v) {
  const t = v >>> 24, a = (v >> 16) & 255, b = (v >> 8) & 255, c = v & 255;
  if (t === 0x09 && a === 0 && b === 0 && c < 3) return `Profile ${c + 1}`;
  if (t === 0x08 && c < 2) {
    const what = { 0: "on/off", 2: "mode", 3: "bright", 4: "speed" }[a];
    const dir = { 0: "", 1: " +", 2: " −" }[b];
    if (what && dir !== undefined) return `${c ? "Side" : "Light"} ${what}${dir}`;
  }
  if (t === 0x07) return `Sys ${c.toString(16).padStart(2, "0")}`;
  return null;
}
const FN_GROUP = {
  id: "kb_functions",
  label: "Keyboard functions",
  items: [
    ...[0, 1, 2].map((n) => 0x09000000 + n),
    ...[0x08000000, 0x08020000, 0x08030100, 0x08030200, 0x08040100, 0x08040200],
    ...[0x08000001, 0x08020001, 0x08030001, 0x08040001],
  ].map((v) => ({ name: fnName(v), value: "0x" + v.toString(16).padStart(8, "0") })),
};
KEYCODES.push(FN_GROUP);

const pretty = (n) => n.replace(/^L_/, "L ").replace(/^R_/, "R ").replace("_", " ");
function keyName(value) {
  if (value === 0) return "—";
  const n = KEY_NAMES.get(value) ?? fnName(value);
  return n ? pretty(n) : "0x" + value.toString(16).padStart(8, "0");
}
const defaultValue = (layer, pos) => Number(LAYOUT[layer].keys.find((k) => k.pos === pos)?.value ?? 0);
const mm = (um) => (um / 1000).toFixed(2) + " mm";

// ---- ui helpers ------------------------------------------------------------

let toastTimer;
function toast(msg, err = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast show" + (err ? " err" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = "toast"), 2600);
}

function busy(text) {
  $("#loading").hidden = !text;
  $("#loadingText").textContent = text || "";
}

async function guarded(label, fn) {
  try {
    busy(label);
    await fn();
  } catch (e) {
    console.error(e);
    toast(e.message || String(e), true);
  } finally {
    busy(null);
  }
}

function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

// ---- keyboard rendering ----------------------------------------------------

const board = $("#board");
const SCALE = 1.42;
const PAD = 14;
const keyEls = new Map();

(function buildBoard() {
  const maxX = Math.max(...BASE.map((k) => k.x + k.w));
  const maxY = Math.max(...BASE.map((k) => k.y + k.h));
  const minX = Math.min(...BASE.map((k) => k.x));
  const minY = Math.min(...BASE.map((k) => k.y));
  board.style.width = (maxX - minX) * SCALE + PAD * 2 + "px";
  board.style.height = (maxY - minY) * SCALE + PAD * 2 + "px";
  for (const k of BASE) {
    const el = document.createElement("div");
    el.className = "key";
    el.style.left = (k.x - minX) * SCALE + PAD + "px";
    el.style.top = (k.y - minY) * SCALE + PAD + "px";
    el.style.width = k.w * SCALE + "px";
    el.style.height = k.h * SCALE + "px";
    el.innerHTML = `<span class="lab"></span><span class="sub"></span>`;
    el.dataset.pos = k.pos;
    board.append(el);
    keyEls.set(k.pos, el);
  }
})();

// click / drag selection
let dragging = null;
board.addEventListener("mousedown", (e) => {
  const el = e.target.closest(".key");
  if (!el) return;
  const pos = Number(el.dataset.pos);
  const additive = (e.ctrlKey || e.shiftKey) && state.tab !== "keymap";
  if (!additive) state.selected.clear();
  dragging = state.tab === "keymap" ? "single" : state.selected.has(pos) ? "remove" : "add";
  toggleSel(pos);
  if (state.tab === "performance" && state.selected.size === 1) loadPerfControls(pos);
  render();
});
board.addEventListener("mouseover", (e) => {
  if (!dragging || dragging === "single") return;
  const el = e.target.closest(".key");
  if (el) {
    toggleSel(Number(el.dataset.pos));
    render();
  }
});
window.addEventListener("mouseup", () => (dragging = null));

function toggleSel(pos) {
  if (dragging === "remove") state.selected.delete(pos);
  else state.selected.add(pos);
}

$$(".sel-tools button").forEach((b) =>
  b.addEventListener("click", () => {
    const s = state.selected;
    if (b.dataset.sel === "all") POSITIONS.forEach((p) => s.add(p));
    if (b.dataset.sel === "none") s.clear();
    if (b.dataset.sel === "wasd") {
      s.clear();
      WASD.forEach((p) => s.add(p));
    }
    if (b.dataset.sel === "invert") POSITIONS.forEach((p) => (s.has(p) ? s.delete(p) : s.add(p)));
    render();
  }),
);

function render() {
  for (const k of BASE) {
    const el = keyEls.get(k.pos);
    const lab = el.firstChild;
    const sub = el.lastChild;
    el.classList.toggle("sel", state.selected.has(k.pos));
    el.classList.remove("changed");
    el.querySelector(".swatch")?.remove();
    sub.innerHTML = "";

    if (state.tab === "keymap") {
      const v = state.keymap[state.layer].get(k.pos);
      lab.textContent = v === undefined ? pretty(k.name) : keyName(v);
      // The bundled layout only knows factory values for the base layer (its Fn tables are base copies).
      if (state.layer === 0 && v !== undefined && v !== defaultValue(0, k.pos)) el.classList.add("changed");
    } else {
      lab.textContent = pretty(k.name);
    }
    el.title = lab.textContent;

    if (state.tab === "performance") {
      const a = state.actuation.get(k.pos);
      const r = state.rt.get(k.pos);
      if (a) sub.innerHTML = `<span>${(a.um / 1000).toFixed(2)}</span>${r?.enabled ? '<span class="rt">RT</span>' : ""}`;
    }

    if (state.tab === "lighting") {
      const c = state.colors.get(k.pos);
      if (c) {
        const sw = document.createElement("i");
        sw.className = "swatch";
        sw.style.background = `rgb(${c.r},${c.g},${c.b})`;
        el.append(sw);
      }
    }
  }
  $("#selCount").textContent = `${state.selected.size} selected`;
  if (state.tab === "keymap") updateKeymapTitle();
  paintPreview();
}

// ---- tabs ------------------------------------------------------------------

$$("#tabs button").forEach((b) =>
  b.addEventListener("click", () => {
    state.tab = b.dataset.tab;
    $$("#tabs button").forEach((x) => x.classList.toggle("active", x === b));
    $$(".panel").forEach((p) => (p.hidden = p.dataset.panel !== state.tab));
    $("#layers").hidden = state.tab !== "keymap";
    $(".sel-tools").style.visibility = state.tab === "settings" ? "hidden" : "visible";
    if (state.tab === "keymap" && state.selected.size > 1) state.selected.clear();
    render();
  }),
);

// ---- connection ------------------------------------------------------------

function setConnected(on, label) {
  $("#status").classList.toggle("on", on);
  $("#status span").textContent = label;
  $("#empty").hidden = on;
  $("#connect").textContent = on ? "Reload" : "Connect";
}

// One connect at a time: the board exposes several HID interfaces and each fires its own "connect" event.
let connecting = null;
function connect(prompt) {
  connecting ??= doConnect(prompt).finally(() => (connecting = null));
  return connecting;
}

async function doConnect(prompt) {
  await guarded("Connecting…", async () => {
    if (state.kb) await state.kb.close();
    state.kb = await HeroKeyboard.connect({ prompt });
    if (!state.kb) {
      setConnected(false, "Not connected");
      if (prompt) toast("Keyboard not found — is it plugged in by USB?", true);
      return;
    }
    await loadAll();
  });
}

async function loadAll() {
  const kb = state.kb;
  busy("Reading device info…");
  const [fw, uuid] = [await kb.getFirmware(), await kb.getUuid()];
  setConnected(true, `HERO 68 HE · fw ${fw.text}`);

  busy("Reading profile…");
  const profile = await kb.getProfile();
  $$("#profiles button").forEach((b) => b.classList.toggle("active", Number(b.dataset.profile) === profile));

  busy("Reading actuation & rapid trigger…");
  state.actuation = await kb.getActuation(POSITIONS);
  state.rt = await kb.getRapidTrigger(POSITIONS);

  for (let l = 0; l < 3; l++) {
    busy(`Reading keymap layer ${l + 1}/3…`);
    state.keymap[l] = await kb.getKeys(l, POSITIONS);
  }

  busy("Reading lighting…");
  state.main = await kb.getLight();
  state.side = await kb.getSideLight();
  state.colors = await kb.getKeyColors(POSITIONS);
  syncLightCard(mainCard, state.main);
  syncLightCard(sideCard, state.side);

  busy("Reading settings…");
  $("#polling").value = String(await kb.getPolling());
  $("#winLock").checked = await kb.getWinLock();
  $("#macMode").checked = await kb.getMacMode();

  $("#info").innerHTML = `
    <dt>Model</dt><dd>HERO 68 HE</dd>
    <dt>Firmware</dt><dd>${fw.text} (0x${fw.raw.toString(16)})</dd>
    <dt>UUID</dt><dd>0x${uuid.toString(16)}</dd>
    <dt>Precision</dt><dd>${(kb.precision / 1000).toFixed(3)} mm</dd>
    <dt>Profile</dt><dd>P${profile + 1}</dd>`;

  const first = [...state.selected][0] ?? 43;
  loadPerfControls(first);
  render();
  if (rhythm.running) rhythm.kb = kb;
}

$("#connect").addEventListener("click", () => connect(true));
navigator.hid.addEventListener("connect", () => setTimeout(() => !state.kb && connect(false), 600));
navigator.hid.addEventListener("disconnect", (e) => {
  if (state.kb && e.device === state.kb.device) {
    state.kb = null;
    setConnected(false, "Disconnected");
  }
});

$$("#profiles button").forEach((b) =>
  b.addEventListener("click", () => {
    if (!state.kb) return;
    guarded("Switching profile…", async () => {
      await state.kb.setProfile(Number(b.dataset.profile));
      await new Promise((r) => setTimeout(r, 300));
      await loadAll();
      toast(`Switched to profile ${Number(b.dataset.profile) + 1}`);
    });
  }),
);

// ---- performance -----------------------------------------------------------

const act = $("#actuation"),
  rtEn = $("#rtEnabled"),
  rtP = $("#rtPress"),
  rtR = $("#rtRelease");
function updatePerfOutputs() {
  $("#actuationOut").textContent = mm(act.value * 10);
  $("#rtPressOut").textContent = mm(rtP.value * 10);
  $("#rtReleaseOut").textContent = mm(rtR.value * 10);
  rtP.disabled = rtR.disabled = !rtEn.checked;
}
[act, rtP, rtR, rtEn].forEach((el) => el.addEventListener("input", updatePerfOutputs));

function loadPerfControls(pos) {
  const a = state.actuation.get(pos);
  const r = state.rt.get(pos);
  if (a) act.value = Math.round(a.um / 10);
  if (r) {
    rtEn.checked = r.enabled;
    rtP.value = Math.max(1, Math.round(r.pressUm / 10));
    rtR.value = Math.max(1, Math.round(r.releaseUm / 10));
  }
  updatePerfOutputs();
}

$("#applyPerf").addEventListener("click", () => {
  if (!state.kb) return toast("Connect the keyboard first", true);
  const keys = [...state.selected];
  if (!keys.length) return toast("Select some keys first", true);
  guarded(`Writing ${keys.length} keys…`, async () => {
    const um = act.value * 10;
    await state.kb.setActuation(keys.map((pos) => ({ pos, um, custom: true })));
    await state.kb.setRapidTrigger(
      keys.map((pos) => ({ pos, enabled: rtEn.checked, pressUm: rtP.value * 10, releaseUm: rtR.value * 10, custom: true })),
    );
    // read back so the board shows what the firmware actually stored
    const a = await state.kb.getActuation(keys);
    const r = await state.kb.getRapidTrigger(keys);
    a.forEach((v, k) => state.actuation.set(k, v));
    r.forEach((v, k) => state.rt.set(k, v));
    render();
    toast(`Saved ${keys.length} key${keys.length > 1 ? "s" : ""}`);
  });
});
updatePerfOutputs();

// ---- keymap ----------------------------------------------------------------

let pickerGroup = KEYCODES[0].id;
$$("#layers button").forEach((b) =>
  b.addEventListener("click", () => {
    state.layer = Number(b.dataset.layer);
    $$("#layers button").forEach((x) => x.classList.toggle("active", x === b));
    $("#resetKey").disabled = state.layer !== 0;
    $("#resetKey").title = state.layer ? "Factory values are only known for the base layer — use Reset whole layer" : "";
    render();
  }),
);

function buildPicker() {
  $("#pickerGroups").innerHTML = "";
  for (const g of KEYCODES) {
    const b = document.createElement("button");
    b.textContent = g.label;
    b.classList.toggle("active", g.id === pickerGroup);
    b.onclick = () => {
      pickerGroup = g.id;
      $("#pickerSearch").value = "";
      buildPicker();
    };
    $("#pickerGroups").append(b);
  }
  const q = $("#pickerSearch").value.trim().toLowerCase();
  const items = q
    ? KEYCODES.flatMap((g) => g.items).filter((i) => i.name.toLowerCase().includes(q))
    : KEYCODES.find((g) => g.id === pickerGroup).items;
  const picker = $("#picker");
  picker.innerHTML = "";
  for (const it of items) {
    const b = document.createElement("button");
    b.textContent = pretty(it.name);
    b.title = `${it.name} (${it.value})`;
    b.onclick = () => assignKey(Number(it.value));
    picker.append(b);
  }
}
$("#pickerSearch").addEventListener("input", buildPicker);
buildPicker();

function updateKeymapTitle() {
  const [pos] = state.selected;
  const k = BASE.find((x) => x.pos === pos);
  $("#keymapTitle").textContent = k
    ? `${pretty(k.name)} on ${["Base", "Fn1", "Fn2"][state.layer]} → ${keyName(state.keymap[state.layer].get(pos) ?? 0)}`
    : "Select a key to remap";
}

function assignKey(value, positions = [...state.selected]) {
  if (!state.kb) return toast("Connect the keyboard first", true);
  if (!positions.length) return toast("Select a key first", true);
  const layer = state.layer;
  guarded("Remapping…", async () => {
    await state.kb.setKeys(layer, positions.map((pos) => ({ pos, value })));
    const back = await state.kb.getKeys(layer, positions);
    back.forEach((v, k) => state.keymap[layer].set(k, v));
    render();
    toast(`Mapped to ${keyName(value)}`);
  });
}

$("#resetKey").addEventListener("click", () => {
  const positions = [...state.selected];
  if (!positions.length) return toast("Select a key first", true);
  const layer = state.layer;
  guarded("Resetting key…", async () => {
    await state.kb.setKeys(layer, positions.map((pos) => ({ pos, value: defaultValue(layer, pos) })));
    const back = await state.kb.getKeys(layer, positions);
    back.forEach((v, k) => state.keymap[layer].set(k, v));
    render();
  });
});

$("#resetLayer").addEventListener("click", () => {
  if (!state.kb) return;
  const layer = state.layer;
  if (!confirm(`Reset every key on the ${["Base", "Fn1", "Fn2"][layer]} layer to factory defaults?`)) return;
  guarded("Resetting layer…", async () => {
    await state.kb.resetLayer(layer);
    await new Promise((r) => setTimeout(r, 300));
    state.keymap[layer] = await state.kb.getKeys(layer, POSITIONS);
    render();
    toast("Layer reset");
  });
});

// ---- lighting --------------------------------------------------------------

const mainCard = $("#mainLight"),
  sideCard = $("#sideLight");
const hex = (c) => "#" + [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, "0")).join("");
const rgb = (h) => ({ r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) });

function setupLightCard(card, modes, limits, write) {
  const sel = $(".mode", card);
  sel.innerHTML = modes.map((m) => `<option value="${m.mode}">${m.name}</option>`).join("");
  $(".bright", card).max = limits.bright;
  $(".speed", card).max = limits.speed;
  const push = debounce(() => {
    if (!state.kb) return;
    const l = readLightCard(card);
    write(l).then(
      () => {},
      (e) => toast(e.message, true),
    );
  }, 120);
  card.addEventListener("input", () => {
    refreshLightCard(card, modes);
    push();
  });
}

function readLightCard(card) {
  return {
    mode: Number($(".mode", card).value),
    rainbow: $(".rainbow", card).checked,
    ...rgb($(".color", card).value),
    bright: Number($(".bright", card).value),
    speed: Number($(".speed", card).value),
  };
}

function syncLightCard(card, l) {
  $(".mode", card).value = String(l.mode);
  $(".rainbow", card).checked = l.rainbow;
  $(".color", card).value = hex(l);
  $(".bright", card).value = l.bright;
  $(".speed", card).value = l.speed;
  refreshLightCard(card, card === mainCard ? MAIN_MODES : SIDE_MODES);
}

function refreshLightCard(card, modes) {
  const outs = $$("output", card);
  outs[0].textContent = $(".bright", card).value;
  outs[1].textContent = $(".speed", card).value;
  const m = modes.find((x) => x.mode === Number($(".mode", card).value));
  const off = m?.mode === 0;
  const colorable = m?.color !== false;
  $(".color", card).disabled = off || !colorable || $(".rainbow", card).checked;
  $(".rainbow", card).disabled = off || !colorable;
}

setupLightCard(mainCard, MAIN_MODES, MAIN_LIMITS, async (l) => {
  await state.kb.setLight(l);
  state.main = l;
});
setupLightCard(sideCard, SIDE_MODES, SIDE_LIMITS, async (l) => {
  await state.kb.setSideLight(l);
  state.side = l;
});

$("#paint").addEventListener("click", () => {
  if (!state.kb) return toast("Connect the keyboard first", true);
  const keys = [...state.selected];
  if (!keys.length) return toast("Select some keys first", true);
  const c = rgb($("#paintColor").value);
  guarded("Painting keys…", async () => {
    await state.kb.setKeyColors(keys.map((pos) => ({ pos, ...c })));
    const back = await state.kb.getKeyColors(keys);
    back.forEach((v, k) => state.colors.set(k, v));
    render();
    if (state.main?.mode !== 19) toast("Saved — switch main mode to “Custom (per-key)” to see it");
    else toast(`Painted ${keys.length} keys`);
  });
});

// ---- music rhythm ----------------------------------------------------------

const rhythm = new RhythmEngine(BASE);
const SETTINGS_KEY = "rhythm-settings";
try {
  Object.assign(rhythm.settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"));
} catch {}
const saveRhythm = () => {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(rhythm.settings));
  } catch {}
};

$("#rhythmEffect").innerHTML = EFFECTS.map((e) => `<option value="${e.id}">${e.name}</option>`).join("");
$("#rhythmPalette").innerHTML = PALETTES.map((p) => `<option value="${p.id}">${p.name}</option>`).join("");
$("#rhythmGain").value = rhythm.settings.gain;
$("#rhythmSmooth").value = rhythm.settings.smooth;
$("#rhythmPalette").value = rhythm.settings.palette;
$("#rhythmColor").value = hex(rhythm.settings.color);

function syncRhythmControls() {
  $("#rhythmGain").nextElementSibling.textContent = $("#rhythmGain").value;
  $("#rhythmSmooth").nextElementSibling.textContent = $("#rhythmSmooth").value;
  $("#rhythmColor").hidden = $("#rhythmPalette").value !== "solid";
}
syncRhythmControls();

$("#rhythmCard").addEventListener("input", (e) => {
  if (e.target.id === "rhythmEffect") return;
  Object.assign(rhythm.settings, {
    gain: Number($("#rhythmGain").value),
    smooth: Number($("#rhythmSmooth").value),
    palette: $("#rhythmPalette").value,
    color: rgb($("#rhythmColor").value),
  });
  syncRhythmControls();
  saveRhythm();
});

function setRhythmRunning(on) {
  const s = $("#rhythmStatus");
  s.textContent = on ? "Live" : "Off";
  s.className = "pill " + (on ? "live" : "");
  mainCard.classList.toggle("disabled", on);
  $(".rhythm-note", mainCard).hidden = !on;
  if (!on) {
    preview = null;
    paintPreview();
  }
}

$("#rhythmEffect").addEventListener("change", async (e) => {
  const id = e.target.value;
  if (id !== "off" && !state.kb) {
    e.target.value = "off";
    return toast("Connect the keyboard first", true);
  }
  try {
    rhythm.kb = state.kb;
    await rhythm.setEffect(id);
    setRhythmRunning(rhythm.running);
    // the firmware restores the saved lighting ~3 s after the last frame
    if (!rhythm.running && state.kb) setTimeout(async () => syncLightCard(mainCard, (state.main = await state.kb.getLight())), 3500);
  } catch (err) {
    e.target.value = "off";
    rhythm.stop();
    setRhythmRunning(false);
    toast("Couldn't capture system audio: " + err.message, true);
  }
});

// live preview of what is being sent to the keyboard
let preview = null;
let previewQueued = false;
function paintPreview() {
  previewQueued = false;
  const on = state.tab === "lighting" && preview && rhythm.running;
  for (const [pos, el] of keyEls) {
    const c = on ? (preview.all ?? preview.get(pos)) : null;
    el.style.backgroundColor = c && c.r + c.g + c.b ? `rgba(${c.r},${c.g},${c.b},0.55)` : "";
  }
}
rhythm.onFrame = (f) => {
  preview = f;
  if (!previewQueued) {
    previewQueued = true;
    requestAnimationFrame(paintPreview);
  }
};

// ---- settings --------------------------------------------------------------

$("#polling").innerHTML = POLLING_RATES.map((p) => `<option value="${p.level}">${p.hz} Hz</option>`).join("");
$("#polling").addEventListener("change", (e) =>
  guarded("Setting polling rate…", async () => {
    const hz = $("#polling").selectedOptions[0].textContent;
    await state.kb.setPolling(Number(e.target.value));
    toast(`Polling rate ${hz} — keyboard is reconnecting…`);
    // the board drops off USB here; the hid "connect" listener reloads everything when it comes back
  }),
);
$("#winLock").addEventListener("change", (e) => guarded("Saving…", () => state.kb.setWinLock(e.target.checked)));
$("#macMode").addEventListener("change", (e) => guarded("Saving…", () => state.kb.setMacMode(e.target.checked)));

// ---- boot ------------------------------------------------------------------

render();
connect(false);
