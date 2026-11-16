/** Web Audio helpers for the generated bed: the context, noise buffer, sessions and the timers that drive them. */

export interface Synth { ctx: AudioContext; master: GainNode; noise: AudioBuffer }

type Timer = ReturnType<typeof setTimeout>;

/** One running piece of the bed (an ambience or the music): a bus, its sources and its timers. */
export interface Session { bus: GainNode; srcs: AudioScheduledSourceNode[]; timers: Timer[]; dead: boolean; level: number }

export const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

/** Create the audio context, or null where Web Audio does not exist (Node, old browsers). */
export function createSynth(): Synth | null {
  const g = globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const C = g.AudioContext ?? g.webkitAudioContext;
  if (!C) return null;
  try {
    const ctx = new C();
    const master = ctx.createGain();
    master.gain.value = 0.85;
    master.connect(ctx.destination);
    const noise = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return { ctx, master, noise };
  } catch {
    return null;
  }
}

export function gain(x: Synth, v: number): GainNode {
  const g = x.ctx.createGain();
  g.gain.value = v;
  return g;
}

export function filter(x: Synth, type: BiquadFilterType, f: number, q?: number): BiquadFilterNode {
  const n = x.ctx.createBiquadFilter();
  n.type = type;
  n.frequency.value = f;
  if (q) n.Q.value = q;
  return n;
}

/** `instant` skips the slow fade-in, for one-off sounds such as the chime. */
export function session(x: Synth, level: number, instant = false): Session {
  const s: Session = { bus: gain(x, instant ? level : 0), srcs: [], timers: [], dead: false, level };
  s.bus.connect(x.master);
  if (!instant) s.bus.gain.setTargetAtTime(level, x.ctx.currentTime, 0.6);
  return s;
}

export function endSession(x: Synth, s: Session | null, fade = 0.5): void {
  if (!s || s.dead) return;
  s.dead = true;
  s.timers.forEach(clearTimeout);
  const t = x.ctx.currentTime;
  s.bus.gain.cancelScheduledValues(t);
  s.bus.gain.setTargetAtTime(0, t, fade);
  setTimeout(() => {
    s.srcs.forEach((n) => { try { n.stop(); } catch {} });
    try { s.bus.disconnect(); } catch {}
  }, (fade * 5 + 0.3) * 1000);
}

export function noise(x: Synth, s: Session): AudioBufferSourceNode {
  const n = x.ctx.createBufferSource();
  n.buffer = x.noise;
  n.loop = true;
  n.start(0, Math.random() * 2);
  s.srcs.push(n);
  return n;
}

export function lfo(x: Synth, s: Session, hz: number, depth: number, target: AudioParam): void {
  const o = x.ctx.createOscillator();
  o.frequency.value = hz;
  const g = gain(x, depth);
  o.connect(g);
  g.connect(target);
  o.start();
  s.srcs.push(o);
}

/** Run `fn` at random intervals between a and b seconds until the session ends. */
export function every(s: Session, a: number, b: number, fn: () => void, first?: number): void {
  const tick = (): void => {
    if (s.dead) return;
    try { fn(); } catch {}
    s.timers.push(setTimeout(tick, rnd(a, b) * 1000));
  };
  s.timers.push(setTimeout(tick, (first === undefined ? rnd(0.5, a) : first) * 1000));
}
