/** The generated soundscapes (layers and the named presets) and the underscore music. Ported from the v1 prototype. */
import { type Session, type Synth, every, filter, gain, lfo, noise, rnd } from "./synth";

const when = (x: Synth, t: number): number => x.ctx.currentTime + t;

export const L = {
  water(x: Synth, s: Session, lv: number): void {
    const n = noise(x, s), lp = filter(x, "lowpass", 430), g = gain(x, lv * 0.5);
    n.connect(lp); lp.connect(g); g.connect(s.bus); lfo(x, s, 0.11, lv * 0.3, g.gain);
    const n2 = noise(x, s), bp = filter(x, "bandpass", 1700, 0.6), g2 = gain(x, lv * 0.05);
    n2.connect(bp); bp.connect(g2); g2.connect(s.bus); lfo(x, s, 0.27, lv * 0.04, g2.gain);
  },
  wind(x: Synth, s: Session, lv: number): void {
    const n = noise(x, s), bp = filter(x, "bandpass", 520, 1.4), g = gain(x, lv * 0.3);
    n.connect(bp); bp.connect(g); g.connect(s.bus); lfo(x, s, 0.06, 260, bp.frequency); lfo(x, s, 0.09, lv * 0.15, g.gain);
  },
  rumble(x: Synth, s: Session, lv: number): void {
    const n = noise(x, s), lp = filter(x, "lowpass", 95), g = gain(x, lv * 0.9);
    n.connect(lp); lp.connect(g); g.connect(s.bus);
  },
  murmur(x: Synth, s: Session, lv: number): void {
    const mk = (f: number, q: number, base: number): void => {
      const n = noise(x, s), bp = filter(x, "bandpass", f, q), g = gain(x, lv * base);
      n.connect(bp); bp.connect(g); g.connect(s.bus);
      every(s, 0.3, 0.8, () => g.gain.setTargetAtTime(lv * base * rnd(0.5, 1.6), x.ctx.currentTime, 0.25), 0.2);
    };
    mk(360, 0.8, 0.22); mk(880, 1.1, 0.09);
  },
  creak(x: Synth, s: Session, lv: number): void {
    every(s, 4, 11, () => {
      const t = x.ctx.currentTime, o = x.ctx.createOscillator(), f0 = rnd(70, 120);
      o.type = "sawtooth";
      o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f0 * 1.5, t + 0.35); o.frequency.linearRampToValueAtTime(f0 * 0.9, t + 0.95);
      const bp = filter(x, "bandpass", rnd(600, 1100), 9), g = gain(x, 0);
      g.gain.linearRampToValueAtTime(lv * 0.13, t + 0.15); g.gain.linearRampToValueAtTime(lv * 0.05, t + 0.5); g.gain.linearRampToValueAtTime(0, t + 1.0);
      o.connect(bp); bp.connect(g); g.connect(s.bus); o.start(t); o.stop(t + 1.1);
    });
  },
  gulls(x: Synth, s: Session, lv: number): void {
    every(s, 9, 22, () => {
      const n = 2 + Math.floor(Math.random() * 3), base = rnd(0.9, 1.15);
      for (let i = 0; i < n; i++) {
        const t = x.ctx.currentTime + i * 0.42, o = x.ctx.createOscillator(), g = gain(x, 0);
        o.frequency.setValueAtTime(1300 * base, t); o.frequency.linearRampToValueAtTime(2100 * base, t + 0.08); o.frequency.linearRampToValueAtTime(1100 * base, t + 0.34);
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(lv * 0.045, t + 0.05); g.gain.linearRampToValueAtTime(0, t + 0.36);
        o.connect(g); g.connect(s.bus); o.start(t); o.stop(t + 0.4);
      }
    }, rnd(3, 7));
  },
  hammer(x: Synth, s: Session, lv: number): void {
    every(s, 1.6, 5, () => {
      const n = 1 + Math.floor(Math.random() * 3), ring = rnd(480, 620);
      for (let i = 0; i < n; i++) {
        const t = x.ctx.currentTime + i * 0.3;
        const b = x.ctx.createBufferSource();
        b.buffer = x.noise;
        const bp = filter(x, "bandpass", 2300, 4), g = gain(x, 0);
        g.gain.setValueAtTime(lv * 0.22, t); g.gain.exponentialRampToValueAtTime(0.0008, t + 0.09);
        b.connect(bp); bp.connect(g); g.connect(s.bus); b.start(t, Math.random()); b.stop(t + 0.12);
        const o = x.ctx.createOscillator(), g2 = gain(x, 0);
        o.frequency.value = ring; g2.gain.setValueAtTime(lv * 0.06, t); g2.gain.exponentialRampToValueAtTime(0.0008, t + 0.5);
        o.connect(g2); g2.connect(s.bus); o.start(t); o.stop(t + 0.55);
      }
    });
  },
  clink(x: Synth, s: Session, lv: number): void {
    every(s, 5, 14, () => {
      const t = x.ctx.currentTime, f = rnd(2700, 3700);
      [1, 1.52].forEach((r) => {
        const o = x.ctx.createOscillator(), g = gain(x, 0);
        o.frequency.value = f * r; g.gain.setValueAtTime(lv * 0.035, t); g.gain.exponentialRampToValueAtTime(0.0008, t + 0.3);
        o.connect(g); g.connect(s.bus); o.start(t); o.stop(t + 0.35);
      });
    });
  },
  drips(x: Synth, s: Session, lv: number): void {
    const d = x.ctx.createDelay(1);
    d.delayTime.value = 0.33;
    const fb = gain(x, 0.5);
    d.connect(fb); fb.connect(d); d.connect(s.bus);
    every(s, 1.2, 4, () => {
      const t = x.ctx.currentTime, o = x.ctx.createOscillator(), g = gain(x, 0), f = rnd(1400, 2000);
      o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.6, t + 0.07);
      g.gain.setValueAtTime(lv * 0.1, t); g.gain.exponentialRampToValueAtTime(0.0008, t + 0.1);
      o.connect(g); g.connect(s.bus); g.connect(d); o.start(t); o.stop(t + 0.12);
    }, 0.8);
  },
  foghorn(x: Synth, s: Session, lv: number): void {
    every(s, 35, 60, () => {
      const t = x.ctx.currentTime, o = x.ctx.createOscillator(), lp = filter(x, "lowpass", 260), g = gain(x, 0);
      o.type = "sawtooth"; o.frequency.value = 98;
      g.gain.linearRampToValueAtTime(lv * 0.1, t + 0.4); g.gain.setValueAtTime(lv * 0.1, t + 2.2); g.gain.linearRampToValueAtTime(0, t + 2.9);
      o.connect(lp); lp.connect(g); g.connect(s.bus); o.start(t); o.stop(t + 3);
    }, rnd(8, 14));
  },
  /** One bell stroke. `decay` scales how long it rings (1 is the full 3.4 s of the prototype). */
  bell(x: Synth, s: Session, lv: number, f: number, delay = 0, decay = 1): void {
    const t = when(x, delay);
    [1, 2.01, 2.74, 4.1, 5.43].forEach((r, i) => {
      const o = x.ctx.createOscillator(), g = gain(x, 0);
      o.frequency.value = f * r;
      g.gain.setValueAtTime(lv * [0.16, 0.1, 0.07, 0.035, 0.02][i]!, t);
      g.gain.exponentialRampToValueAtTime(0.0006, t + (3.4 * decay) / (1 + i * 0.45));
      o.connect(g); g.connect(s.bus); o.start(t); o.stop(t + 3.6 * decay);
    });
  },
  toll(x: Synth, s: Session, lv: number, f: number, a: number, b: number): void {
    every(s, a, b, () => L.bell(x, s, lv, f), 2.5);
  },
  tick(x: Synth, s: Session, lv: number): void {
    every(s, 1, 1, () => {
      const t = x.ctx.currentTime, b = x.ctx.createBufferSource();
      b.buffer = x.noise;
      const bp = filter(x, "bandpass", 3200, 6), g = gain(x, 0);
      g.gain.setValueAtTime(lv * 0.12, t); g.gain.exponentialRampToValueAtTime(0.0008, t + 0.03);
      b.connect(bp); bp.connect(g); g.connect(s.bus); b.start(t, Math.random()); b.stop(t + 0.05);
    }, 1);
  },
  bells(x: Synth, s: Session, lv: number): void {
    const set = [392, 440, 523.25, 587.33, 659.25];
    every(s, 4, 9, () => L.bell(x, s, lv * 0.7, set[Math.floor(Math.random() * set.length)]!), 3);
  },
};

type Preset = (x: Synth, s: Session) => void;

export const AMB: Record<string, Preset> = {
  river: (x, s) => { L.water(x, s, 0.8); L.gulls(x, s, 0.8); L.foghorn(x, s, 1); L.creak(x, s, 0.4); },
  wharf: (x, s) => { L.water(x, s, 0.4); L.creak(x, s, 0.9); L.gulls(x, s, 0.6); },
  ship: (x, s) => { L.water(x, s, 0.7); L.wind(x, s, 0.4); L.creak(x, s, 1); },
  arctic: (x, s) => { L.wind(x, s, 1); L.water(x, s, 0.8); L.creak(x, s, 0.7); },
  yard: (x, s) => { L.water(x, s, 0.4); L.hammer(x, s, 1); L.gulls(x, s, 0.5); },
  sail: (x, s) => { L.wind(x, s, 0.9); L.water(x, s, 0.6); L.creak(x, s, 0.8); },
  solemn: (x, s) => { L.water(x, s, 0.5); L.wind(x, s, 0.3); L.toll(x, s, 1, 220, 6, 7); },
  tunnel: (x, s) => { L.rumble(x, s, 1); L.drips(x, s, 1); },
  dock: (x, s) => { L.water(x, s, 0.6); L.creak(x, s, 0.6); L.gulls(x, s, 0.5); },
  tavern: (x, s) => { L.murmur(x, s, 1); L.clink(x, s, 1); L.water(x, s, 0.25); L.creak(x, s, 0.4); },
  sailortown: (x, s) => { L.murmur(x, s, 0.7); L.bells(x, s, 1); },
  canal: (x, s) => { L.water(x, s, 0.35); L.wind(x, s, 0.15); },
  clock: (x, s) => { L.wind(x, s, 0.45); L.tick(x, s, 1); },
};

/** Start the named soundscape on a session. Unknown names fall back to the river. */
export function buildAmbience(x: Synth, s: Session, name: string): void {
  (AMB[name] ?? AMB["river"]!)(x, s);
}

/** A slow drone with the occasional bell-like note. "bright" lifts the third. */
export function buildMusic(x: Synth, s: Session, mood: "minor" | "bright"): void {
  const third = mood === "bright" ? 185.0 : 174.61;
  const lp = filter(x, "lowpass", 900);
  lp.connect(s.bus);
  lfo(x, s, 0.05, 320, lp.frequency);
  [73.42, 110, 146.83, third, 220].forEach((f, i) => {
    [-4, 4].forEach((c, j) => {
      const o = x.ctx.createOscillator();
      o.type = j ? "triangle" : "sine"; o.frequency.value = f; o.detune.value = c;
      const g = gain(x, 0.02 - i * 0.0018);
      o.connect(g); g.connect(lp); lfo(x, s, 0.03 + i * 0.011, 0.008, g.gain); o.start(); s.srcs.push(o);
    });
  });
  const d = x.ctx.createDelay(1);
  d.delayTime.value = 0.42;
  const fb = gain(x, 0.38);
  d.connect(fb); fb.connect(d); d.connect(s.bus);
  const scale = mood === "bright" ? [293.66, 329.63, 369.99, 440, 493.88, 587.33] : [293.66, 329.63, 392, 440, 523.25, 587.33];
  every(s, 4.5, 9, () => {
    const t = x.ctx.currentTime, o = x.ctx.createOscillator(), g = gain(x, 0);
    o.type = "triangle"; o.frequency.value = scale[Math.floor(Math.random() * scale.length)]!;
    g.gain.linearRampToValueAtTime(0.03, t + 0.5); g.gain.exponentialRampToValueAtTime(0.0006, t + 3.5);
    o.connect(g); g.connect(s.bus); g.connect(d); o.start(t); o.stop(t + 3.7);
  }, 3);
}
