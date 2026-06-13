// @author: zhjj
// 程序化音效合成器（WebAudio），无需任何音频素材

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private rainSrc: AudioBufferSourceNode | null = null;
  private rainGain: GainNode | null = null;
  muted = false;

  /** 必须在用户手势后调用 */
  unlock(): void {
    if (this.ctx) return;
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    } catch {
      this.ctx = null;
    }
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number): void {
    if (!this.ctx || !this.master || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol: number, filterFreq: number, slideTo?: number): void {
    if (!this.ctx || !this.master || this.muted) return;
    const t = this.ctx.currentTime;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(filterFreq, t);
    if (slideTo !== undefined) filter.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t);
  }

  /** 雨声环境音：循环噪声，音量随雨强变化（0 = 停止） */
  setRain(v: number): void {
    if (!this.ctx || !this.master) return;
    if (v > 0.01 && !this.rainSrc) {
      const len = this.ctx.sampleRate * 2;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 850;
      const g = this.ctx.createGain();
      g.gain.value = 0;
      src.connect(filter).connect(g).connect(this.master);
      src.start();
      this.rainSrc = src;
      this.rainGain = g;
    }
    if (this.rainGain) this.rainGain.gain.value = v * 0.1;
    if (v <= 0.01 && this.rainSrc) {
      this.rainSrc.stop();
      this.rainSrc = null;
      this.rainGain = null;
    }
  }

  cave(): void {
    this.tone(140, 0.5, 'sine', 0.22, 55);
    this.noise(0.4, 0.12, 400, 120);
  }

  chest(): void {
    this.tone(392, 0.12, 'triangle', 0.2);
    setTimeout(() => this.tone(523, 0.12, 'triangle', 0.2), 100);
    setTimeout(() => this.tone(659, 0.25, 'triangle', 0.24), 200);
  }

  swing(): void {
    this.noise(0.12, 0.25, 1800, 500);
  }

  hit(): void {
    this.noise(0.09, 0.5, 900, 300);
    this.tone(180, 0.08, 'square', 0.12, 90);
  }

  chop(): void {
    this.noise(0.08, 0.4, 600, 200);
  }

  hurt(): void {
    this.tone(220, 0.22, 'sawtooth', 0.25, 70);
    this.noise(0.15, 0.3, 500, 150);
  }

  dash(): void {
    this.noise(0.16, 0.18, 2400, 700);
  }

  pickup(): void {
    this.tone(660, 0.1, 'sine', 0.18, 990);
  }

  eat(): void {
    this.tone(330, 0.07, 'square', 0.1, 220);
    this.tone(440, 0.12, 'sine', 0.12, 550);
  }

  bow(): void {
    this.tone(140, 0.12, 'triangle', 0.2, 60);
    this.noise(0.1, 0.15, 3000, 1200);
  }

  save(): void {
    this.tone(523, 0.16, 'sine', 0.2);
    setTimeout(() => this.tone(659, 0.16, 'sine', 0.2), 110);
    setTimeout(() => this.tone(784, 0.3, 'sine', 0.22), 220);
  }

  upgrade(): void {
    this.tone(392, 0.12, 'triangle', 0.2);
    setTimeout(() => this.tone(523, 0.2, 'triangle', 0.22), 90);
  }

  death(): void {
    this.tone(300, 0.7, 'sawtooth', 0.25, 50);
  }

  roar(): void {
    this.tone(90, 0.7, 'sawtooth', 0.35, 45);
    this.noise(0.6, 0.3, 300, 90);
  }

  win(): void {
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.tone(f, 0.35, 'triangle', 0.22), i * 140));
  }

  ui(): void {
    this.tone(880, 0.05, 'sine', 0.1);
  }

  /** 神器祝福：圣光降临的竖琴琶音 */
  blessing(): void {
    [523, 659, 784, 988, 1175].forEach((f, i) => setTimeout(() => this.tone(f, 0.5, 'sine', 0.16), i * 130));
    this.noise(1.2, 0.05, 4000, 6500);
  }

  /** 神器揭晓的圣咏和弦 */
  reveal(): void {
    this.tone(784, 0.4, 'triangle', 0.2);
    setTimeout(() => this.tone(1047, 0.5, 'triangle', 0.2), 120);
    setTimeout(() => this.tone(1568, 0.8, 'sine', 0.16), 240);
  }

  /** 丘比特之箭：坠入爱河 */
  love(): void {
    this.tone(880, 0.12, 'sine', 0.16, 1100);
    setTimeout(() => this.tone(1175, 0.2, 'sine', 0.14), 90);
  }

  /** 冥火爆发 */
  nether(): void {
    this.tone(120, 0.4, 'sawtooth', 0.2, 40);
    this.noise(0.35, 0.28, 700, 120);
  }

  /** 圣翼冲刺 */
  wing(): void {
    this.noise(0.25, 0.22, 2800, 900);
    this.tone(440, 0.22, 'triangle', 0.12, 880);
  }

  /** 雷霆神矛：闪电劈落（big = 雨天大型雷霆，更响更沉） */
  thunder(big: boolean): void {
    // 电光爆裂的高频噼啪
    this.noise(big ? 0.18 : 0.1, big ? 0.4 : 0.28, big ? 5200 : 6000, big ? 1200 : 1800);
    // 滚雷低频轰鸣
    this.tone(big ? 70 : 110, big ? 0.7 : 0.4, 'sawtooth', big ? 0.35 : 0.22, big ? 38 : 60);
    if (big) this.noise(0.5, 0.18, 400, 90);
  }
}

export const sfx = new Sfx();
