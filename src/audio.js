// System-audio capture + spectrum analysis. Electron's main process answers getDisplayMedia with
// WASAPI loopback audio, so this hears whatever the PC is playing without any extra program.

export class AudioAnalyser {
  constructor() {
    this.ctx = null;
    this.stream = null;
    this.analyser = null;
    this.bins = null;
    this.peak = 0.05; // auto-gain reference, adapts to the playback volume
  }

  get running() {
    return !!this.analyser;
  }

  async start() {
    if (this.running) return;
    const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
    stream.getVideoTracks().forEach((t) => t.stop()); // only the audio is wanted
    if (!stream.getAudioTracks().length) throw new Error("No system audio available to capture");
    this.stream = stream;
    this.ctx = new AudioContext();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.5;
    this.ctx.createMediaStreamSource(stream).connect(this.analyser);
    this.bins = new Float32Array(this.analyser.frequencyBinCount);
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close();
    this.ctx = this.stream = this.analyser = this.bins = null;
  }

  // n log-spaced bands between 40 Hz and 14 kHz, each 0..1 after gain and auto-levelling.
  bands(n, gain = 1) {
    if (!this.running) return new Array(n).fill(0);
    this.analyser.getFloatFrequencyData(this.bins); // dBFS per bin
    const hzPerBin = this.ctx.sampleRate / this.analyser.fftSize;
    const lo = Math.log(40), hi = Math.log(14000);
    const out = [];
    let max = 0;
    for (let i = 0; i < n; i++) {
      const a = Math.max(1, Math.floor(Math.exp(lo + ((hi - lo) * i) / n) / hzPerBin));
      const b = Math.max(a + 1, Math.floor(Math.exp(lo + ((hi - lo) * (i + 1)) / n) / hzPerBin));
      let sum = 0;
      for (let k = a; k < b && k < this.bins.length; k++) sum += 10 ** (this.bins[k] / 20);
      const v = (sum / (b - a)) * (1 + i * 0.35); // tilt up the highs, music is bass-heavy
      out.push(v);
      max = Math.max(max, v);
    }
    if (max < 1e-4) return out.fill(0); // silence gate, so auto-gain doesn't blow up the noise floor
    // auto-gain: follow loud passages quickly, quiet ones slowly
    this.peak = max > this.peak ? max : Math.max(0.002, this.peak * 0.995);
    return out.map((v) => Math.min(1, (v / this.peak) * gain));
  }
}
