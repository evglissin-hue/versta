/**
 * The bed on the graph's one AudioContext: a soundscape layer and a music layer, each with its own fade, and the
 * one-shot effects. The mixer decides what changes and how long each fade takes; this module does it on real nodes.
 */
import type { SoundEvent } from "../types";
import catalogue from "./catalogue.json";
import { type Graph, type Levels, createGraph } from "./graph";
import { type LoopLib, createLoopLib } from "./loops";
import { buildAmbience, loopsFor, trimOf } from "./soundscapes";
import { type Session, endSession, session } from "./synth";

/** Soundscape, music and effect levels on the bed bus. The music sits under the soundscape. The master tunes these. */
export const AMB_LEVEL = 0.9;
/** About 8 dB under the soundscapes overall (measured: themes -29 to -33 dBFS alone, soundscapes -21 to -24). */
export const MUS_LEVEL = 1.1;
export const EFFECT_LEVEL = 0.7;
/** How long a starting soundscape waits for its recordings before it starts without them. */
const LOAD_WAIT_MS = 1500;
/** How long an effect waits for its recording to decode before it is dropped. */
const EFFECT_WAIT_MS = 500;

export type LayerKind = "ambience" | "music";
/** Report a bed event for the sound timeline, at the moment it happens. */
export type BedEmit = (ch: "ambience" | "music" | "effect", ev: "on" | "off", src: string) => void;

export interface Bed {
  /** Create or resume the context. Returns false where Web Audio is not available. */
  ensure(): boolean;
  /** The graph, once `ensure` has created it. */
  readonly graph: Graph | null;
  /** Start decoding every signal and every effect in the background (they are small). */
  preload(): void;
  preloadAmbience(name: string): void;
  preloadMusic(theme: string): void;
  /**
   * Put a layer in place: `name` fades in over `fadeIn` seconds, whatever the layer held before fades out over
   * `fadeOut` seconds. `null` only fades the old one out. A newer call for the same layer supersedes one still loading.
   */
  setLayer(kind: LayerKind, name: string | null, fadeIn: number, fadeOut: number): void;
  /** Both layers reach silence `fadeSeconds` from now. */
  stop(fadeSeconds: number): void;
  /** One-shot effect on the bed bus. `level` scales EFFECT_LEVEL. Dropped when it is not decoded within 0.5 s. */
  effect(name: string, level: number): void;
  /** Two soft clicks on the nav bus. */
  tick(): void;
  /** Scale the soundscape and music. Remembered across beds and until the graph exists. */
  setBedLevel(level: number): void;
  dispose(): void;
}

export interface BedHooks {
  emit: BedEmit;
  timeline: () => readonly SoundEvent[];
}

declare global { interface Window { __verstaAudio?: { levels(): Levels; timeline(): readonly SoundEvent[] } } }

interface Layer { name: string; s: Session }

export function createBed(hooks: BedHooks): Bed {
  let g: Graph | null = null;
  let loops: LoopLib | null = null;
  let failed = false;
  let level = 1;
  let disposed = false;
  const layers: Record<LayerKind, Layer | null> = { ambience: null, music: null };
  const tokens: Record<LayerKind, number> = { ambience: 0, music: 0 };
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const later = (ms: number, fn: () => void): void => {
    const t = setTimeout(() => { timers.delete(t); fn(); }, ms);
    timers.add(t);
  };

  const inUse = (): string[] => {
    const out: string[] = [];
    if (layers.ambience) out.push(...loopsFor(layers.ambience.name));
    if (layers.music) out.push(`music/${layers.music.name}`);
    return out;
  };

  const ensure = (): boolean => {
    if (disposed) return false;
    if (!g && !failed) {
      g = createGraph();
      if (!g) failed = true;
      else {
        const base = typeof import.meta.env?.BASE_URL === "string" ? import.meta.env.BASE_URL : "/";
        loops = createLoopLib(g.synth.ctx, base, inUse);
        const graph = g;
        graph.setBedLevel(level);
        if (typeof window !== "undefined") window.__verstaAudio = { levels: () => graph.levels(), timeline: hooks.timeline };
      }
    }
    if (g && g.synth.ctx.state === "suspended") { try { void g.synth.ctx.resume().catch(() => {}); } catch {} }
    return g !== null;
  };

  /** Fade the layer out so that it is silent `fade` seconds from now, then report it off. */
  const retire = (kind: LayerKind, fade: number): void => {
    const c = layers[kind];
    layers[kind] = null;
    if (!c || !g) return;
    endSession(g.synth, c.s, fade);
    later(fade * 1000, () => hooks.emit(kind, "off", c.name));
  };

  return {
    ensure,
    get graph() { return g; },
    preload() {
      if (!ensure() || !loops) return;
      const names = [...Object.keys(catalogue.signals).map((n) => `signals/${n}`), ...Object.keys(catalogue.effects).map((n) => `fx/${n}`)];
      void loops.load(names);
    },
    preloadAmbience(name) {
      if (ensure() && loops) void loops.load(loopsFor(name));
    },
    preloadMusic(theme) {
      if (ensure() && loops) void loops.load([`music/${theme}`]);
    },

    setLayer(kind, name, fadeIn, fadeOut) {
      const token = ++tokens[kind];
      if (!ensure() || !g || !loops) return;
      if (name === null) { retire(kind, fadeOut); return; }
      const x = g.synth, lib = loops;
      const go = (): void => {
        if (token !== tokens[kind] || disposed || !g) return;
        const music = kind === "music" ? lib.get(`music/${name}`) : undefined;
        // the old layer fades out as the new one fades in
        retire(kind, fadeOut);
        if (kind === "music" && !music) return; // a theme that failed to load means no music
        const s = session(x, kind === "ambience" ? AMB_LEVEL * trimOf(name) : MUS_LEVEL, fadeIn);
        if (kind === "ambience") buildAmbience(x, s, name, lib);
        else if (music) {
          const src = x.ctx.createBufferSource();
          src.buffer = music;
          src.loop = true;
          src.connect(s.bus);
          src.start();
          s.srcs.push(src);
        }
        layers[kind] = { name, s };
        hooks.emit(kind, "on", name);
      };
      let fired = false;
      const fire = (): void => { if (!fired) { fired = true; go(); } };
      if (kind === "ambience") {
        // wait a moment for the recordings; without them the generated layers play instead
        later(LOAD_WAIT_MS, fire);
        void lib.load(loopsFor(name)).then(fire);
      } else {
        void lib.load([`music/${name}`]).then(fire);
      }
    },

    stop(fadeSeconds) {
      tokens.ambience++;
      tokens.music++;
      retire("ambience", fadeSeconds);
      retire("music", fadeSeconds);
    },

    effect(name, lvl) {
      if (!ensure() || !g || !loops) return;
      const x = g.synth, lib = loops, key = `fx/${name}`;
      const play = (buf: AudioBuffer): void => {
        if (disposed || !g) return;
        const src = x.ctx.createBufferSource();
        const gn = x.ctx.createGain();
        gn.gain.value = EFFECT_LEVEL * Math.max(0, lvl);
        src.buffer = buf;
        src.connect(gn);
        gn.connect(x.bed);
        src.onended = () => { try { gn.disconnect(); } catch {} hooks.emit("effect", "off", name); };
        src.start();
        hooks.emit("effect", "on", name);
      };
      const ready = lib.get(key);
      if (ready) { play(ready); return; }
      let late = false;
      later(EFFECT_WAIT_MS, () => { late = true; });
      void lib.load([key]).then(() => {
        const buf = lib.get(key);
        if (buf && !late) play(buf);
      });
    },

    tick() {
      if (!ensure() || !g) return;
      g.tick();
    },
    setBedLevel(l) {
      level = Math.max(0, l);
      g?.setBedLevel(level);
    },
    dispose() {
      if (disposed) return;
      tokens.ambience++;
      tokens.music++;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      for (const k of ["ambience", "music"] as const) {
        const c = layers[k];
        layers[k] = null;
        if (c && g) endSession(g.synth, c.s, 0.05);
      }
      disposed = true;
      const c = g;
      g = null;
      failed = true;
      if (typeof window !== "undefined") delete window.__verstaAudio;
      c?.dispose();
    },
  };
}
