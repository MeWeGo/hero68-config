// Macros tab UI: macro list, recorder, event editor and key binding. Drafted by Gemini 3.8 Flash, reviewed in Claude Code.
let current = 0;

export function initMacrosTab(ctx) {
  const { $, state, toast, guarded, render, BASE, LAYER_NAMES, Macros } = ctx;

  let recording = false;
  let lastEventTime = null;

  function renderList() {
    const list = $("#macroList");
    if (!list) return;
    list.replaceChildren();

    state.macros.forEach((m, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      if (idx === current) btn.classList.add("active");
      btn.textContent = `${m.name} (${m.events.length})`;
      btn.addEventListener("click", () => {
        if (recording) stopRecording();
        current = idx;
        refresh();
      });
      list.appendChild(btn);
    });
  }

  function renderTitle() {
    const title = $("#macroTitle");
    if (!title) return;
    const m = state.macros[current];
    title.textContent = m
      ? `${m.name} (${m.events.length} / ${Macros.MAX_EVENTS} events)`
      : "No macro selected";
  }

  function renderEvents() {
    const container = $("#macroEvents");
    if (!container) return;
    container.replaceChildren();

    const m = state.macros[current];
    if (!m) return;

    m.events.forEach((ev, idx) => {
      const row = document.createElement("div");
      row.className = "ev";

      const dir = document.createElement("span");
      dir.className = `dir ${ev.up ? "up" : "down"}`;
      dir.textContent = ev.up ? "↑" : "↓";

      const label = document.createElement("span");
      label.className = "label";
      label.textContent = Macros.eventLabel(ev.code);

      const delay = document.createElement("input");
      delay.type = "number";
      delay.min = "0";
      delay.max = "60000";
      delay.className = "num";
      delay.value = ev.delay ?? 0;
      delay.addEventListener("change", () => {
        let val = parseInt(delay.value, 10);
        if (isNaN(val) || val < 0) val = 0;
        val = Math.max(0, Math.min(60000, val));
        delay.value = val;
        ev.delay = val;
        persist();
      });

      const del = document.createElement("button");
      del.type = "button";
      del.className = "del";
      del.textContent = "×";
      del.addEventListener("click", () => {
        m.events.splice(idx, 1);
        persist();
      });

      row.append(dir, label, delay, del);
      container.appendChild(row);
    });
  }

  function persist() {
    Macros.saveMacros(state.macros);
    refresh();
  }

  function refresh() {
    if (recording && $('[data-panel="macros"]')?.hidden) {
      stopRecording();
    }
    if (state.macros.length === 0) {
      current = -1;
    } else if (current < 0 || current >= state.macros.length) {
      current = 0;
    }
    renderList();
    renderTitle();
    renderEvents();
  }

  function stopRecording() {
    if (!recording) return;
    recording = false;
    lastEventTime = null;
    const btn = $("#macroRecord");
    if (btn) {
      btn.textContent = "● Record";
      btn.classList.remove("recording");
    }
    window.removeEventListener("keydown", onKeyEvent, true);
    window.removeEventListener("keyup", onKeyEvent, true);
  }

  function startRecording() {
    const m = state.macros[current];
    if (!m) return toast("No macro selected", true);
    if (m.events.length >= Macros.MAX_EVENTS) {
      return toast(`Maximum of ${Macros.MAX_EVENTS} events reached`, true);
    }
    recording = true;
    lastEventTime = null;
    const btn = $("#macroRecord");
    if (btn) {
      btn.textContent = "■ Stop";
      btn.classList.add("recording");
    }
    window.addEventListener("keydown", onKeyEvent, true);
    window.addEventListener("keyup", onKeyEvent, true);
  }

  function onKeyEvent(e) {
    if ($('[data-panel="macros"]')?.hidden) {
      stopRecording();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat) return;
    if (!Macros.isRecordable(e.code)) return;

    const m = state.macros[current];
    if (!m) {
      stopRecording();
      return;
    }

    if (m.events.length >= Macros.MAX_EVENTS) {
      toast(`Maximum of ${Macros.MAX_EVENTS} events reached`, true);
      stopRecording();
      return;
    }

    const now = performance.now();
    if (m.events.length > 0 && lastEventTime !== null) {
      const prev = m.events[m.events.length - 1];
      prev.delay = Math.min(60000, Math.max(0, Math.round(now - lastEventTime)));
    }
    lastEventTime = now;

    m.events.push({
      code: e.code,
      up: e.type === "keyup",
      delay: 0,
    });

    persist();

    const evBox = $("#macroEvents");
    if (evBox) evBox.scrollTop = evBox.scrollHeight;

    if (m.events.length >= Macros.MAX_EVENTS) {
      toast(`Maximum of ${Macros.MAX_EVENTS} events reached`, true);
      stopRecording();
    }
  }

  function addMacro() {
    const input = $("#macroName");
    const name = input.value.trim();
    if (!name) return toast("Enter a macro name", true);
    if (state.macros.some((m) => m.name.toLowerCase() === name.toLowerCase())) {
      return toast("Macro name already exists", true);
    }
    if (state.macros.length >= 32) {
      return toast("Maximum 32 macros reached", true);
    }
    state.macros.push({ name, events: [] });
    current = state.macros.length - 1;
    input.value = "";
    persist();
  }

  $("#macroAdd").addEventListener("click", addMacro);
  $("#macroName").addEventListener("keydown", (e) => {
    if (e.key === "Enter") addMacro();
  });

  $("#macroRecord").addEventListener("click", () => {
    if (recording) stopRecording();
    else startRecording();
  });

  const mouseSelect = $("#macroMouse");
  mouseSelect.replaceChildren();
  const defaultMouseOpt = document.createElement("option");
  defaultMouseOpt.value = "";
  defaultMouseOpt.textContent = "+ Mouse click…";
  mouseSelect.appendChild(defaultMouseOpt);
  for (const [code, label] of Macros.MOUSE) {
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = label;
    mouseSelect.appendChild(opt);
  }
  mouseSelect.addEventListener("change", () => {
    const code = mouseSelect.value;
    if (!code) return;
    const m = state.macros[current];
    if (!m) {
      mouseSelect.value = "";
      return toast("No macro selected", true);
    }
    if (m.events.length + 2 > Macros.MAX_EVENTS) {
      mouseSelect.value = "";
      return toast(`Maximum of ${Macros.MAX_EVENTS} events reached`, true);
    }
    m.events.push({ code, up: false, delay: 50 }, { code, up: true, delay: 50 });
    mouseSelect.value = "";
    persist();
  });

  $("#macroAllDelay").addEventListener("change", (e) => {
    const m = state.macros[current];
    if (!m) return;
    const val = parseInt(e.target.value, 10);
    if (isNaN(val) || val < 0) return;
    const delay = Math.max(0, Math.min(60000, val));
    e.target.value = delay;
    for (const ev of m.events) {
      ev.delay = delay;
    }
    persist();
  });

  $("#macroClear").addEventListener("click", () => {
    const m = state.macros[current];
    if (!m) return;
    m.events = [];
    persist();
  });

  $("#macroDelete").addEventListener("click", async () => {
    const m = state.macros[current];
    if (!m) return;
    if (!confirm(`Delete macro "${m.name}"?`)) return;
    if (recording) stopRecording();
    state.macros.splice(current, 1);
    if (current >= state.macros.length) {
      current = state.macros.length - 1;
    }
    persist();
    if (state.kb) {
      await guarded("Updating macros…", async () => {
        await state.kb.writeMacros(Macros.encodeMacros(state.macros));
      });
      toast("Keys bound to later macros may now point to a different macro.", true);
    }
  });

  const modeSelect = $("#macroMode");
  modeSelect.replaceChildren();
  for (const mode of Macros.MODES) {
    const opt = document.createElement("option");
    opt.value = mode.id;
    opt.textContent = mode.name;
    modeSelect.appendChild(opt);
  }

  const countRow = $("#macroCountRow");
  function updateCountRow() {
    if (countRow) countRow.hidden = modeSelect.value !== "times";
  }
  modeSelect.addEventListener("change", updateCountRow);
  updateCountRow();

  $("#macroBind").addEventListener("click", async () => {
    if (!state.kb) return toast("Keyboard not connected", true);
    const m = state.macros[current];
    if (!m || m.events.length === 0) {
      return toast("Select a macro with at least one event", true);
    }
    const pos = [...state.selected][0];
    if (pos == null) {
      return toast("Select a key to bind first", true);
    }

    await guarded("Binding macro…", async () => {
      await state.kb.writeMacros(Macros.encodeMacros(state.macros));
      const mode = $("#macroMode").value;
      const count = Math.max(1, Math.min(255, parseInt($("#macroCount").value, 10) || 1));
      const value = Macros.macroKeycode(current, mode, count);
      await state.kb.setKeys(state.layer, [{ pos, value }]);
      const readBack = await state.kb.getKeys(state.layer, [pos]);
      if (readBack && state.keymap[state.layer]) {
        for (const [p, v] of readBack) {
          state.keymap[state.layer].set(p, v);
        }
      }
      render();
      const keyName = BASE.find((b) => b.pos === pos)?.name ?? `key ${pos}`;
      const layerName = LAYER_NAMES[state.layer] ?? `Layer ${state.layer}`;
      toast(`Bound ${m.name} to ${keyName} on ${layerName}`);
    });
  });

  refresh();
  return { refresh };
}
