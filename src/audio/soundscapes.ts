/** Soundscape recipes (recorded loops plus generated layers) and the generated music under a story. */
import type { LoopLib } from "./loops";
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

export type Preset = (x: Synth, s: Session) => void;

/**
 * One layer of a soundscape. With `loop`, the recording plays on a loop when it has loaded; `gen` is the generated
 * layer that plays in its place when the recording is missing. With `fx` and `every`, the layer is sparse: the named
 * effect (public/sounds/fx/<fx>.mp3) plays once at a random gap of `every[0]` to `every[1]` seconds. `pan` places the
 * layer between the ears, never further than 0.3 either way so one earbud never loses a layer.
 */
export interface Part { loop?: string; fx?: string; every?: [number, number]; level?: number; pan?: number; gen?: Preset }

const MAX_PAN = 0.3;

const R = (loop: string, level: number, gen?: Preset, pan?: number): Part => {
  const p: Part = { loop, level };
  if (gen) p.gen = gen;
  if (pan !== undefined) p.pan = pan;
  return p;
};

/** A sparse one-shot layer: effect `fx` (public/sounds/fx/<fx>.mp3) every `every[0]` to `every[1]` seconds. */
const S = (fx: string, every: [number, number], level: number, pan?: number): Part => {
  const p: Part = { fx, every, level };
  if (pan !== undefined) p.pan = pan;
  return p;
};

/** Level of a recorded loop (they are normalised to about -26 LUFS) relative to the generated layers. */
export const LOOP_LEVEL = 1.6;

/**
 * Recipes: a steady base and one or two texture layers, recorded where a recording exists (docs/sound-credits.md),
 * generated (`gen`) where none does or while it loads. A sparse one-shot layer (S) plays an effect now and then and
 * sits at least 6 dB under the base. Rigging, cobbles, the foot tunnel, wading birds and the dockyard have no recording
 * under the licence bar: their loops are synthesised with sfx-skill (tools/sound/sfx/), as are the nine effects that
 * had no recording.
 */
export const RECIPES: Record<string, Part[]> = {
  river: [R("water", 1, (x, s) => L.water(x, s, 0.8)), R("gulls2", 0.45, (x, s) => L.gulls(x, s, 0.8), 0.25), R("wind", 0.2, (x, s) => L.wind(x, s, 0.2), -0.2), S("ship-horn", [50, 100], 0.4)],
  wharf: [R("wharf", 1, (x, s) => L.water(x, s, 0.4)), R("lap", 0.5, (x, s) => L.water(x, s, 0.3), -0.2), R("creak", 0.45, (x, s) => L.creak(x, s, 0.9), 0.15), R("gulls", 0.4, (x, s) => L.gulls(x, s, 0.6), 0.25)],
  ship: [R("lap", 0.8, (x, s) => L.water(x, s, 0.7)), R("creak", 0.8, (x, s) => L.creak(x, s, 1), -0.15), R("rigging", 0.4, (x, s) => L.wind(x, s, 0.4), 0.25)],
  arctic: [R("wind", 1, (x, s) => L.wind(x, s, 1)), R("ice", 0.7, (x, s) => L.creak(x, s, 0.7), -0.2), R("shore", 0.25, (x, s) => L.water(x, s, 0.8), 0.2), S("ice-creak", [35, 70], 0.4)],
  yard: [R("timber", 0.8, (x, s) => L.hammer(x, s, 1), -0.15), R("wharf", 0.5, (x, s) => L.water(x, s, 0.4)), R("gulls", 0.3, (x, s) => L.gulls(x, s, 0.5), 0.25), S("hammer", [14, 30], 0.35, 0.15)],
  sail: [R("rigging", 0.9, (x, s) => L.creak(x, s, 0.8), -0.1), R("wind", 0.4, (x, s) => L.wind(x, s, 0.9), 0.2), R("lap", 0.5, (x, s) => L.water(x, s, 0.6), -0.2), S("sail-flap", [25, 55], 0.35, 0.15)],
  solemn: [R("water", 0.5, (x, s) => L.water(x, s, 0.5)), R("wind", 0.35, (x, s) => L.wind(x, s, 0.3), 0.2), R("church", 0.4, undefined, -0.15), R("bells", 0.5, (x, s) => L.toll(x, s, 1, 220, 6, 7), 0.15)],
  tunnel: [R("tunnel", 1, (x, s) => L.rumble(x, s, 1)), R("drips", 0.5, (x, s) => L.drips(x, s, 1), 0.2)],
  dock: [R("lap", 0.9, (x, s) => L.water(x, s, 0.6)), R("tide", 0.4, undefined, -0.2), R("gulls", 0.45, (x, s) => L.gulls(x, s, 0.5), 0.25), R("creak", 0.3, (x, s) => L.creak(x, s, 0.6), 0.15)],
  tavern: [R("pub", 1, (x, s) => L.murmur(x, s, 1)), R("murmur", 0.3, undefined, 0.2), S("tankards", [20, 45], 0.4, -0.15)],
  sailortown: [R("murmur", 0.7, (x, s) => L.murmur(x, s, 0.7)), R("cobbles", 0.4, undefined, -0.2), R("bells", 0.4, (x, s) => L.bells(x, s, 1), 0.2), R("gulls2", 0.25, undefined, 0.25)],
  canal: [R("water", 0.6, (x, s) => L.water(x, s, 0.35)), R("wind", 0.2, (x, s) => L.wind(x, s, 0.15), 0.2), R("birds", 0.3, undefined, -0.2)],
  clock: [R("wind", 0.45, (x, s) => L.wind(x, s, 0.45)), R("tick", 1, (x, s) => L.tick(x, s, 1))],
  burial: [R("wind", 0.7, (x, s) => L.wind(x, s, 0.5), 0.2), R("church", 0.5, undefined, -0.15), R("bells", 0.35, (x, s) => L.toll(x, s, 1, 220, 12, 14), 0.2), R("birds", 0.3, undefined, -0.2)],
  office: [R("office", 1, (x, s) => L.tick(x, s, 0.8)), R("hum", 0.2, undefined, 0.15), R("murmur", 0.1, undefined, -0.2)],
  rally: [R("crowd", 1, (x, s) => L.murmur(x, s, 1)), R("murmur", 0.4, undefined, 0.2), R("wind", 0.2, (x, s) => L.wind(x, s, 0.2), -0.2)],
  park: [R("wind", 0.7, (x, s) => L.wind(x, s, 0.4), 0.2), R("murmur", 0.4, undefined, -0.2), R("birds", 0.35, undefined, 0.15)],
  basin: [R("tide", 1, (x, s) => L.water(x, s, 0.5)), R("waders", 0.5, (x, s) => L.gulls(x, s, 0.5), -0.25), R("lap", 0.5, (x, s) => L.water(x, s, 0.4), -0.2), R("gulls", 0.3, undefined, 0.25), R("wind", 0.3, (x, s) => L.wind(x, s, 0.3), 0.2), S("waders", [30, 60], 0.3, 0.2)],
  "working-dock": [R("wharf", 1, (x, s) => L.water(x, s, 0.5)), R("dockyard", 0.6, (x, s) => L.hammer(x, s, 0.5), -0.15), R("lap", 0.4, (x, s) => L.water(x, s, 0.4), -0.2), R("gulls", 0.3, (x, s) => L.gulls(x, s, 0.4), 0.25), S("chain", [18, 40], 0.35, 0.15), S("hammer", [25, 50], 0.3, -0.15), S("crates", [30, 60], 0.3, 0.2)],
  mill: [R("weir", 1, (x, s) => L.water(x, s, 0.8)), R("wind", 0.2, (x, s) => L.wind(x, s, 0.2), 0.2), R("birds", 0.25, undefined, -0.2), S("water-wheel", [30, 60], 0.35, 0.15)],
  pumping: [R("hum", 1, (x, s) => L.rumble(x, s, 1)), R("water", 0.3, (x, s) => L.water(x, s, 0.3), 0.2), R("drips", 0.25, undefined, -0.15), S("water-flow", [30, 60], 0.4, -0.15)],
  towpath: [R("river", 0.7, (x, s) => L.water(x, s, 0.4)), R("wind", 0.4, (x, s) => L.wind(x, s, 0.3), 0.2), R("birds", 0.3, undefined, -0.2)],
  oldstreet: [R("murmur", 0.8, (x, s) => L.murmur(x, s, 0.6)), R("cobbles", 0.5, undefined, 0.15), R("bells", 0.3, (x, s) => L.bells(x, s, 1), -0.2), R("gulls2", 0.25, undefined, 0.25), R("wind", 0.15, (x, s) => L.wind(x, s, 0.15), 0.2)],
};

/**
 * Level trim per soundscape, in dB, measured through the real mixer: each alone from the Sound check screen, 24
 * one-second readings. Each gets the most it can take within five limits: about -21.5 dBFS in the speech band and no
 * more than -21 dBFS overall (there the pocket leaves the bed 14 to 18 dB under the voice), -21.5 dBFS in the phone
 * band (300 Hz to 8 kHz, which the pocket does not reach), and for bursts (the loudest tenth of the seconds, such as
 * birdsong) -19.5 dBFS in the phone band and -26 dBFS above 4 kHz. The tunnel is mostly low rumble and is capped at
 * +5 dB. Measured with the recordings of 22 November and the synthesised layers (tools/sound/sfx/) by tools/sound/measure-scapes.mjs (check-mix confirms); measure again
 * whenever a recipe or a recording changes.
 */
export const TRIM_DB: Record<string, number> = {
  river: 1.1, wharf: 1.8, ship: 1.8, arctic: -0.2, yard: 6.0, sail: 4.5, solemn: 3.9, tunnel: 0.5, dock: 2.5,
  tavern: -0.3, sailortown: 2.6, canal: 5.6, clock: 1.7, burial: 5.0, office: 2.8, rally: 0.6, park: 5.8, basin: 0.3,
  "working-dock": 1.4, mill: 2.8, pumping: -0.4, towpath: 4.5, oldstreet: 1.6,
};

/** The gain the trim of a soundscape stands for (the river's for an unknown name, as with its recipe). */
export const trimOf = (name: string): number => 10 ** ((TRIM_DB[name] ?? TRIM_DB["river"] ?? 0) / 20);

const recipeFor = (name: string): Part[] => RECIPES[name] ?? RECIPES["river"]!;

/** The loop names a soundscape uses and the `fx/<name>` names of its sparse layers, so they can be loaded before it starts. */
export function loopsFor(name: string): string[] {
  return recipeFor(name).flatMap((p) => (p.loop ? [p.loop] : p.fx ? [`fx/${p.fx}`] : []));
}

/** Every loop and effect name any recipe mentions. */
export function allLoops(): string[] {
  return [...new Set(Object.keys(RECIPES).flatMap(loopsFor))];
}

/** Connect a layer's gain to the session bus, through a stereo panner when it has a pan. */
function wire(x: Synth, s: Session, g: GainNode, pan: number | undefined): void {
  if (pan === undefined || pan === 0) { g.connect(s.bus); return; }
  const p = x.ctx.createStereoPanner();
  p.pan.value = Math.max(-MAX_PAN, Math.min(MAX_PAN, pan));
  g.connect(p); p.connect(s.bus);
}

/**
 * Start the named soundscape on a session. Unknown names fall back to the river. `onFx` hears each sparse one-shot
 * start and end, so the sound timeline can show it.
 */
export function buildAmbience(x: Synth, s: Session, name: string, loops: LoopLib | null, onFx?: (fx: string, ev: "on" | "off") => void): void {
  for (const part of recipeFor(name)) {
    if (part.fx) {
      const fx = part.fx;
      const [a, b] = part.every ?? [30, 60];
      every(s, a, b, () => {
        const buf = loops?.get(`fx/${fx}`);
        if (!buf) return;
        const src = x.ctx.createBufferSource();
        src.buffer = buf;
        const g = gain(x, (part.level ?? 0.4) * LOOP_LEVEL);
        src.connect(g); wire(x, s, g, part.pan);
        src.onended = () => { const i = s.srcs.indexOf(src); if (i >= 0) s.srcs.splice(i, 1); onFx?.(fx, "off"); };
        s.srcs.push(src);
        src.start();
        onFx?.(fx, "on");
      }, rnd(a * 0.3, a));
      continue;
    }
    const buf = part.loop ? loops?.get(part.loop) : undefined;
    if (part.loop && buf) {
      const src = x.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const g = gain(x, (part.level ?? 1) * LOOP_LEVEL);
      src.connect(g); wire(x, s, g, part.pan);
      src.start(0, Math.random() * buf.duration);
      s.srcs.push(src);
    } else if (part.gen) {
      part.gen(x, s);
    }
  }
}

/** Keep a one-shot source in the session so ending the session stops it, and let go of it when it ends. */
function track(s: Session, o: AudioScheduledSourceNode): void {
  s.srcs.push(o);
  o.onended = () => { const i = s.srcs.indexOf(o); if (i >= 0) s.srcs.splice(i, 1); };
}

/** A chord: frequencies in Hz, low to high. */
type Chord = number[];

const CHORDS: Record<"minor" | "bright", Chord[]> = {
  // D minor, B flat, G minor, A minor
  minor: [[146.83, 174.61, 220, 293.66], [116.54, 146.83, 174.61, 233.08], [98, 146.83, 196, 233.08], [110, 164.81, 220, 261.63]],
  // D major, G major seventh, A major, B minor
  bright: [[146.83, 185, 220, 293.66], [98, 146.83, 185, 246.94], [110, 164.81, 220, 277.18], [123.47, 185, 246.94, 293.66]],
};

const LINE: Record<"minor" | "bright", number[]> = {
  minor: [293.66, 329.63, 349.23, 392, 440, 466.16, 523.25],
  bright: [293.66, 329.63, 369.99, 440, 493.88, 587.33],
};

/** One chord of the pad: soft attack, long release, two slightly detuned voices per note. */
function padChord(x: Synth, s: Session, chord: Chord, hold: number): void {
  const t = x.ctx.currentTime, attack = 5, release = 7;
  const lp = filter(x, "lowpass", 1100);
  const env = gain(x, 0);
  lp.connect(env); env.connect(s.bus);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(1, t + attack);
  env.gain.setValueAtTime(1, t + hold);
  env.gain.linearRampToValueAtTime(0, t + hold + release);
  chord.forEach((f, i) => {
    [-5, 5].forEach((c, j) => {
      const o = x.ctx.createOscillator();
      o.type = j ? "triangle" : "sine";
      o.frequency.value = f;
      o.detune.value = c;
      const g = gain(x, 0.05 - i * 0.006);
      o.connect(g); g.connect(lp);
      o.start(t); o.stop(t + hold + release + 0.1);
      track(s, o);
    });
  });
}

/**
 * Generated music: a slow modal pad that changes chord every 20 to 30 seconds, and a sparse line over it. The line is
 * reed-like in the minor mood and plucked in the bright one.
 */
export function buildMusic(x: Synth, s: Session, mood: "minor" | "bright"): void {
  const chords = CHORDS[mood];
  let idx = Math.floor(Math.random() * chords.length);
  const next = (): void => {
    if (s.dead) return;
    const hold = rnd(20, 30);
    padChord(x, s, chords[idx % chords.length]!, hold + 2);
    idx++;
    s.timers.push(setTimeout(next, hold * 1000));
  };
  next();

  const d = x.ctx.createDelay(1);
  d.delayTime.value = 0.45;
  const fb = gain(x, 0.35);
  const dlp = filter(x, "lowpass", 1800);
  d.connect(dlp); dlp.connect(fb); fb.connect(d); dlp.connect(s.bus);
  const line = LINE[mood];
  let last = -1;
  every(s, 5, 10, () => {
    let k = Math.floor(Math.random() * line.length);
    if (k === last) k = (k + 1) % line.length;
    last = k;
    const t = x.ctx.currentTime, f = line[k]!;
    const o = x.ctx.createOscillator(), g = gain(x, 0), lp = filter(x, "lowpass", 1500);
    if (mood === "minor") {
      // reed-like: slow attack, a little vibrato
      o.type = "sawtooth"; o.frequency.value = f;
      lp.frequency.value = 1100;
      lfo(x, s, 5.2, 4, o.frequency);
      g.gain.linearRampToValueAtTime(0.05, t + 0.35); g.gain.setValueAtTime(0.05, t + 1.4); g.gain.linearRampToValueAtTime(0, t + 2.6);
    } else {
      // plucked: instant attack, quick decay, the filter closes as it rings
      o.type = "triangle"; o.frequency.value = f;
      lp.frequency.setValueAtTime(3200, t); lp.frequency.exponentialRampToValueAtTime(700, t + 1.2);
      g.gain.setValueAtTime(0.09, t); g.gain.exponentialRampToValueAtTime(0.0006, t + 3);
    }
    o.connect(lp); lp.connect(g); g.connect(s.bus); g.connect(d);
    o.start(t); o.stop(t + 3.1);
    track(s, o);
  }, 3);
}
