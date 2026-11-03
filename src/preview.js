// Throttled live preview of music-rhythm frames on the on-screen board. Drafted by Gemini 3.8 Flash, reviewed in Claude Code.
export function createPreview({ keyEls, board, fps = 15, cap = { r: 38, g: 40, b: 50 }, mix = 0.55 }) {
  const interval = 1000 / fps;
  const inv = 1 - mix;
  const cache = new Map();

  let currentFrame = null;
  let enabled = true;
  let lastPaint = 0;
  let timer = null;
  let raf = null;

  // Blend color over cap using mix; dark/missing keys return ""
  function blend(c) {
    if (!c || !(c.r || c.g || c.b)) return "";
    const r = Math.round(cap.r * inv + c.r * mix);
    const g = Math.round(cap.g * inv + c.g * mix);
    const b = Math.round(cap.b * inv + c.b * mix);
    return `rgb(${r},${g},${b})`;
  }

  function paint() {
    lastPaint = performance.now();
    const isLive = Boolean(enabled && currentFrame);
    board.classList.toggle("live", isLive);

    const hasAll = Boolean(isLive && currentFrame.all);
    const allColor = hasAll ? blend(currentFrame.all) : "";

    for (const [pos, el] of keyEls) {
      const color = isLive ? (hasAll ? allColor : blend(currentFrame.get(pos))) : "";
      if (cache.get(pos) !== color) {
        cache.set(pos, color);
        el.style.backgroundColor = color;
      }
    }
  }

  function cancel() {
    clearTimeout(timer);
    cancelAnimationFrame(raf);
    timer = null;
    raf = null;
  }

  function schedule() {
    if (!enabled || document.hidden || timer || raf) return;
    const elapsed = performance.now() - lastPaint;
    timer = setTimeout(() => {
      timer = null;
      raf = requestAnimationFrame(() => {
        raf = null;
        if (!enabled || document.hidden) return;
        paint();
      });
    }, Math.max(0, interval - elapsed));
  }

  return {
    push(frame) {
      currentFrame = frame;
      schedule();
    },
    setEnabled(on) {
      enabled = Boolean(on);
      cancel();
      paint();
    },
    clear() {
      cancel();
      currentFrame = null;
      paint();
    }
  };
}
