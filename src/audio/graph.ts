/**
 * The audio graph: one AudioContext, three buses (voice, nav, bed) and a master with a gentle limiter.
 *
 *   voice element -> voice chain -> fader -> voice bus -----------------\
 *   nav element   -> nav chain   -> nav bus ----------------------------+-> master -> limiter -> out
 *   bed layers -> pocket (wide cut near 1.5 kHz) -> bed level ----------/
 *
 * Analysers on the voice and nav buses tell the pocket when speech is present: the bed then eases down in the
 * speech band and a little overall, and comes back in the gaps. Lows and highs keep sounding around the voice.
 */
import { type Synth, makeNoise } from "./synth";

/** Base level of the bed bus. Calibrated with tools/sound/check-mix.mjs: the bed sits about 8 dB under the voice in the gaps. */
export const BED_LEVEL = 0.9;
/** Pocket depth at the centre (dB) and the overall bed drop (dB) while speech is present. */
export const POCKET_DB = -14;
/** A second, narrower cut over the body of the voice, so the whole speech band is carved, not only its centre. */
export const BODY_HZ = 500;
export const BODY_Q = 1.2;
export const BODY_DB = -7;
export const POCKET_Q = 0.8;
export const POCKET_HZ = 1300;
export const BED_DROP_DB = -2;
/** Time constants (seconds) of the pocket: about 80 ms to close, about 600 ms to open. */
const ATTACK_TAU = 0.035;
const RELEASE_TAU = 0.22;
/** Speech is present above this RMS on the voice or nav bus (dBFS), and for this long after the last loud block. */
const SPEECH_DB = -50;
const SPEECH_HOLD_MS = 220;
const DRIVE_MS = 30;
/** The turn tick: two clicks this far apart, at this pitch and level. */
const TICK_GAP = 0.12;
const TICK_HZ = 1500;
const TICK_GAIN = 0.2;
/** Time constant of a bed level change: about 300 ms to settle. */
const BED_LEVEL_TAU = 0.1;

export interface Levels {
  /** RMS in dBFS of the voice bus (voice and nav together). */
  voice: number;
  /** RMS in dBFS of the bed bus after the pocket: overall and in three bands. */
  bed: { all: number; low: number; mid: number; high: number };
  /** True while the pocket is closed (speech present). */
  pocketClosed: boolean;
}

/** A gain the mixer ramps to fade a bus: the one place a fade is a Web Audio ramp. */
export interface Fader {
  /** Jump to this gain (0 to 1) now. */
  set(value: number): void;
  /** Ramp linearly from the current gain to `value`, arriving `seconds` from now. */
  ramp(value: number, seconds: number): void;
}

export interface Graph {
  synth: Synth;
  /** The fader on the voice bus (stories and asides). Routed elements only: others fade with element.volume. */
  voiceFader: Fader;
  /** Connect a media element to the voice or nav chain. Returns false when it cannot be routed. */
  route(el: HTMLMediaElement, bus: "voice" | "nav"): boolean;
  /** Fallback for elements that could not be routed: tell the pocket speech is present. */
  hint(speaking: boolean): void;
  /** Two short soft clicks on the nav bus: "the turn is here". */
  tick(): void;
  /** Scale the bed bus around its designed level (1), smoothed over about 300 ms. */
  setBedLevel(level: number): void;
  levels(): Levels;
  dispose(): void;
}

const db = (power: number): number => 10 * Math.log10(power + 1e-12);

function analyser(ctx: AudioContext, size: number): { node: AnalyserNode; buf: Float32Array<ArrayBuffer> } {
  const node = ctx.createAnalyser();
  node.fftSize = size;
  node.smoothingTimeConstant = 0;
  return { node, buf: new Float32Array(new ArrayBuffer(size * 4)) };
}

function rms(a: { node: AnalyserNode; buf: Float32Array<ArrayBuffer> }): number {
  a.node.getFloatTimeDomainData(a.buf);
  let s = 0;
  for (let i = 0; i < a.buf.length; i++) s += a.buf[i]! * a.buf[i]!;
  return db(s / a.buf.length);
}

function biquad(ctx: AudioContext, type: BiquadFilterType, f: number, q = 0.707, g = 0): BiquadFilterNode {
  const n = ctx.createBiquadFilter();
  n.type = type;
  n.frequency.value = f;
  n.Q.value = q;
  n.gain.value = g;
  return n;
}

/** The narrator chain: high-pass, a little warmth and presence, light compression. Subtle by design. */
function speechChain(ctx: AudioContext): { input: AudioNode; output: AudioNode } {
  const hp = biquad(ctx, "highpass", 70);
  // The narration files are mastered with their warmth and presence already in them (tools/voice.py),
  // so these stay flat. They are kept in the chain for packs recorded without that mastering.
  const warmth = biquad(ctx, "peaking", 200, 0.9, 0);
  const presence = biquad(ctx, "peaking", 3000, 0.9, 0);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -24;
  comp.knee.value = 18;
  comp.ratio.value = 2.2;
  comp.attack.value = 0.012;
  comp.release.value = 0.22;
  hp.connect(warmth); warmth.connect(presence); presence.connect(comp);
  return { input: hp, output: comp };
}

/** Two cascaded biquads: about 24 dB per octave, steep enough for band meters. */
function band(ctx: AudioContext, kind: "low" | "mid" | "high"): { input: AudioNode; output: AudioNode } {
  const stages: BiquadFilterNode[] =
    kind === "low" ? [biquad(ctx, "lowpass", 250, 0.707), biquad(ctx, "lowpass", 250, 0.707)]
    : kind === "high" ? [biquad(ctx, "highpass", 4000, 0.707), biquad(ctx, "highpass", 4000, 0.707)]
    : [biquad(ctx, "highpass", 250, 0.707), biquad(ctx, "highpass", 250, 0.707), biquad(ctx, "lowpass", 4000, 0.707), biquad(ctx, "lowpass", 4000, 0.707)];
  for (let i = 0; i + 1 < stages.length; i++) stages[i]!.connect(stages[i + 1]!);
  return { input: stages[0]!, output: stages[stages.length - 1]! };
}

/** Build the graph, or return null where Web Audio does not exist. */
export function createGraph(): Graph | null {
  const g = globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const C = g.AudioContext ?? g.webkitAudioContext;
  if (!C) return null;
  let ctx: AudioContext;
  try { ctx = new C(); } catch { return null; }

  try {
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 3;
    limiter.ratio.value = 16;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.12;
    limiter.connect(ctx.destination);
    const master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(limiter);

    const voiceBus = ctx.createGain();
    const navBus = ctx.createGain();
    voiceBus.connect(master);
    navBus.connect(master);
    const voiceChain = speechChain(ctx);
    const navChain = speechChain(ctx);
    const voiceFade = ctx.createGain();
    voiceChain.output.connect(voiceFade);
    voiceFade.connect(voiceBus);
    navChain.output.connect(navBus);

    const bedIn = ctx.createGain();
    const pocket = biquad(ctx, "peaking", POCKET_HZ, POCKET_Q, 0);
    const body = biquad(ctx, "peaking", BODY_HZ, BODY_Q, 0);
    const bedLevel = ctx.createGain();
    bedLevel.gain.value = BED_LEVEL;
    bedIn.connect(body); body.connect(pocket); pocket.connect(bedLevel); bedLevel.connect(master);

    const synth: Synth = { ctx, bed: bedIn, master, noise: makeNoise(ctx) };

    // meters: what the voice and nav buses carry, and what the bed bus carries after the pocket
    const vA = analyser(ctx, 1024), nA = analyser(ctx, 1024);
    voiceBus.connect(vA.node); navBus.connect(nA.node);
    const bAll = analyser(ctx, 8192), bLow = analyser(ctx, 8192), bMid = analyser(ctx, 8192), bHigh = analyser(ctx, 8192);
    bedLevel.connect(bAll.node);
    for (const [k, a] of [["low", bLow], ["mid", bMid], ["high", bHigh]] as const) {
      const f = band(ctx, k);
      bedLevel.connect(f.input);
      f.output.connect(a.node);
    }

    // the pocket driver
    let closed = false;
    let lastSpeech = -Infinity;
    let hinted = false;
    let routed = 0;
    let userLevel = 1;
    const bedBase = (): number => BED_LEVEL * userLevel;
    const setPocket = (shut: boolean): void => {
      if (shut === closed) return;
      closed = shut;
      const t = ctx.currentTime, tau = shut ? ATTACK_TAU : RELEASE_TAU;
      pocket.gain.setTargetAtTime(shut ? POCKET_DB : 0, t, tau);
      body.gain.setTargetAtTime(shut ? BODY_DB : 0, t, tau);
      bedLevel.gain.setTargetAtTime(shut ? bedBase() * 10 ** (BED_DROP_DB / 20) : bedBase(), t, tau);
    };
    const drive = setInterval(() => {
      const now = Date.now();
      if (Math.max(rms(vA), rms(nA)) > SPEECH_DB || (routed < 2 && hinted)) lastSpeech = now;
      setPocket(now - lastSpeech < SPEECH_HOLD_MS);
    }, DRIVE_MS);

    const voiceFader: Fader = {
      set(value) {
        const t = ctx.currentTime;
        voiceFade.gain.cancelScheduledValues(t);
        voiceFade.gain.setValueAtTime(value, t);
      },
      ramp(value, seconds) {
        const t = ctx.currentTime;
        const now = voiceFade.gain.value;
        voiceFade.gain.cancelScheduledValues(t);
        voiceFade.gain.setValueAtTime(now, t);
        voiceFade.gain.linearRampToValueAtTime(value, t + Math.max(0.005, seconds));
      },
    };

    return {
      synth,
      voiceFader,
      route(el, bus) {
        try {
          const src = ctx.createMediaElementSource(el);
          src.connect((bus === "voice" ? voiceChain : navChain).input);
          routed++;
          return true;
        } catch {
          return false;
        }
      },
      hint(speaking) { hinted = speaking; },
      tick() {
        const t0 = ctx.currentTime + 0.01;
        for (const at of [t0, t0 + TICK_GAP]) {
          const osc = ctx.createOscillator();
          const env = ctx.createGain();
          osc.type = "triangle";
          osc.frequency.value = TICK_HZ;
          env.gain.setValueAtTime(0, at);
          env.gain.linearRampToValueAtTime(TICK_GAIN, at + 0.004);
          env.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
          osc.connect(env);
          env.connect(navBus);
          osc.start(at);
          osc.stop(at + 0.06);
          osc.onended = () => { try { env.disconnect(); } catch {} };
        }
      },
      setBedLevel(level) {
        userLevel = Math.max(0, level);
        const t = ctx.currentTime;
        bedLevel.gain.cancelScheduledValues(t);
        bedLevel.gain.setTargetAtTime(closed ? bedBase() * 10 ** (BED_DROP_DB / 20) : bedBase(), t, BED_LEVEL_TAU);
      },
      levels() {
        const mid = rms(bMid);
        return { voice: db(10 ** (rms(vA) / 10) + 10 ** (rms(nA) / 10)), bed: { all: rms(bAll), low: rms(bLow), mid, high: rms(bHigh) }, pocketClosed: closed };
      },
      dispose() {
        clearInterval(drive);
        setTimeout(() => { void ctx.close().catch(() => {}); }, 500);
      },
    };
  } catch {
    try { void ctx.close(); } catch {}
    return null;
  }
}
