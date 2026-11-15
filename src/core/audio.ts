/** Tiny procedural SFX via WebAudio. Lazily created on first user gesture. */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private rollSrc: AudioBufferSourceNode | null = null;
  private rollGain: GainNode | null = null;
  muted = false;

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch {
      this.ctx = null;
    }
  }

  private ready(): boolean {
    return !!this.ctx && !!this.master && !this.muted;
  }

  tone(freq: number, dur = 0.15, type: OscillatorType = 'sine', vol = 0.3, slideTo?: number, delay = 0): void {
    if (!this.ready()) return;
    const c = this.ctx!;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  noise(dur = 0.2, freq = 1200, vol = 0.4, q = 1, delay = 0): void {
    if (!this.ready() || !this.noiseBuf) return;
    const c = this.ctx!;
    const t = c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(this.master!);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.02);
  }

  /** Continuous rolling rumble; set level 0..1 every frame. */
  roll(level: number): void {
    if (!this.ready() || !this.noiseBuf) return;
    const c = this.ctx!;
    if (!this.rollSrc) {
      this.rollSrc = c.createBufferSource();
      this.rollSrc.buffer = this.noiseBuf;
      this.rollSrc.loop = true;
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 180;
      this.rollGain = c.createGain();
      this.rollGain.gain.value = 0;
      this.rollSrc.connect(f).connect(this.rollGain).connect(this.master!);
      this.rollSrc.start();
    }
    this.rollGain!.gain.setTargetAtTime(level * 0.9, c.currentTime, 0.05);
  }

  crash(intensity: number): void {
    const n = 3 + Math.round(intensity * 6);
    for (let i = 0; i < n; i++) {
      this.noise(0.08 + Math.random() * 0.12, 1800 + Math.random() * 2500, 0.25 + intensity * 0.3, 4, i * 0.035 * Math.random() * 3);
      this.tone(500 + Math.random() * 700, 0.08, 'triangle', 0.12, undefined, i * 0.03);
    }
  }

  volume = 0.5;

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this.volume;
  }

  /** Bright little plink per pin hit; pitch climbs with each pin in the same roll. */
  plink(n: number): void {
    const f = 520 * Math.pow(1.122, Math.min(n, 12));
    this.tone(f, 0.12, 'triangle', 0.16, f * 1.5);
  }

  boing(): void {
    this.tone(220, 0.35, 'sine', 0.35, 520);
  }

  fanfare(): void {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.25, 'square', 0.12, undefined, i * 0.1));
  }

  sad(): void {
    this.tone(330, 0.5, 'triangle', 0.25, 160);
  }

  pop(): void {
    this.tone(700, 0.08, 'sine', 0.2, 1200);
  }
}
