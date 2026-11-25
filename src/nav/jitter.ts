/**
 * What a phone's GPS does in central London, as a seeded model for the simulator and the dead-end hunt
 * (docs/build/it7-32-jitter-hunt.md). Pure: local metres in and out, no browser APIs.
 *
 * "urban": white noise of 3 m on a slow bias of about 5 m; every 70 s or so a multipath spell of 3 to 25 s that
 * throws the fix 20 to 60 m to one side, reached within two seconds and wandering a little, with an accuracy figure
 * that lies (4 to 10 m) in 60 percent of spells; duplicate fixes (2 percent), late fixes (1 percent: a fix from 5 to
 * 20 s ago arriving now), gaps of 3 to 8 s (1 percent of seconds), and now and then (1 in 400) a wild network fix
 * 100 to 300 m out with an accuracy of 20 to 50 m. Speed and bearing carry their own small noise; the bearing is
 * null below 1 m/s, as the plugin reports it.
 * "clean": the white noise only, accuracy 6 m.
 */
import type { XY } from "../geo";

export type JitterProfile = "urban" | "clean";

/** Where the rider really is at a simulated second. */
export interface Truth { p: XY; time: number; speed: number; heading: number | null }

/** A fix as the phone would deliver it, in local metres. */
export interface RawFix { p: XY; accuracy: number; speed: number | null; heading: number | null; time: number; receivedAt: number }

export interface JitterModel {
  /** The fixes the phone delivers for this second: none (a gap), one, or two (a duplicate or a late one as well). */
  next(t: Truth): RawFix[];
}

/** Small seeded generator (mulberry32). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createJitter(seed: number, profile: JitterProfile = "urban"): JitterModel {
  const rand = seeded(seed);
  const gauss = (): number => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  const between = (a: number, b: number): number => a + (b - a) * rand();
  const urban = profile === "urban";

  let bias: XY = [0, 0];
  let lastTime: number | null = null;
  let spell: { start: number; end: number; dir: number; size: number; lies: boolean; wander: XY } | null = null;
  let gapUntil = -Infinity;
  const history: RawFix[] = [];

  function measure(t: Truth): RawFix {
    const dt = lastTime === null ? 1 : Math.max(0, (t.time - lastTime) / 1000);
    lastTime = t.time;
    let accuracy = urban ? between(4, 8) : 6;
    let off: XY = [gauss() * 3, gauss() * 3];
    if (urban) {
      // slow bias: Ornstein-Uhlenbeck, 5 m, 20 s
      const k = Math.min(1, dt / 20);
      bias = [bias[0] * (1 - k) + 5 * Math.sqrt(2 * k) * gauss(), bias[1] * (1 - k) + 5 * Math.sqrt(2 * k) * gauss()];
      off = [off[0] + bias[0], off[1] + bias[1]];
      if (!spell && rand() < dt / 70) {
        const len = between(3, 25);
        spell = { start: t.time, end: t.time + len * 1000, dir: rand() * 2 * Math.PI, size: between(20, 60), lies: rand() < 0.6, wander: [0, 0] };
      }
      if (spell) {
        const age = (t.time - spell.start) / 1000;
        const left = (spell.end - t.time) / 1000;
        const ramp = Math.min(1, age / 2, Math.max(0, left));
        spell.wander = [spell.wander[0] * 0.8 + gauss() * 2, spell.wander[1] * 0.8 + gauss() * 2];
        const m = spell.size * ramp;
        off = [off[0] + Math.sin(spell.dir) * m + spell.wander[0], off[1] + Math.cos(spell.dir) * m + spell.wander[1]];
        accuracy = spell.lies ? between(4, 10) : Math.max(accuracy, m * between(0.6, 1));
        if (t.time >= spell.end) spell = null;
      }
    }
    const moving = t.speed >= 1;
    const speed = Math.max(0, moving ? t.speed + gauss() * 0.3 : Math.abs(gauss() * 0.2));
    const heading = moving && t.heading !== null ? (((t.heading + gauss() * 8) % 360) + 360) % 360 : null;
    return { p: [t.p[0] + off[0], t.p[1] + off[1]], accuracy, speed, heading, time: t.time, receivedAt: t.time };
  }

  return {
    next(t) {
      const fix = measure(t);
      history.push(fix);
      if (history.length > 30) history.shift();
      if (!urban) return [fix];
      if (t.time < gapUntil) return [];
      if (rand() < 0.01) { gapUntil = t.time + between(3, 8) * 1000; return []; }
      if (rand() < 1 / 400) {
        const dir = rand() * 2 * Math.PI, d = between(100, 300);
        return [{ ...fix, p: [t.p[0] + Math.sin(dir) * d, t.p[1] + Math.cos(dir) * d], accuracy: between(20, 50), speed: null, heading: null }];
      }
      const out = [fix];
      if (rand() < 0.02) out.push({ ...fix });
      if (rand() < 0.01) {
        const ago = between(5, 20);
        const old = history.find((h) => t.time - h.time >= ago * 1000);
        if (old) out.push({ ...old, receivedAt: t.time });
      }
      return out;
    },
  };
}
