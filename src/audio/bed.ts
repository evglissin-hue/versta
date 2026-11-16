/** The generated bed (ambience plus music) and the chime, on one lazily created AudioContext. */
import { type Session, type Synth, createSynth, endSession, session } from "./synth";
import { L, buildAmbience, buildMusic } from "./soundscapes";

export type Mood = "minor" | "bright";

const AMB_LEVEL = { open: 0.9, ducked: 0.5 };
const MUS_LEVEL = { open: 0.8, ducked: 0.45 };

export interface Bed {
  /** Create or resume the context. Returns false where Web Audio is not available. */
  ensure(): boolean;
  start(ambience: string | null, mood: Mood | null): void;
  stop(fadeSeconds: number): void;
  duck(on: boolean): void;
  /** Two strokes of a ship's bell. */
  chime(): void;
  dispose(): void;
}

export function createBed(): Bed {
  let x: Synth | null = null;
  let failed = false;
  let amb: Session | null = null;
  let mus: Session | null = null;
  let ducked = false;

  const ensure = (): boolean => {
    if (!x && !failed) {
      x = createSynth();
      if (!x) failed = true;
    }
    if (x && x.ctx.state === "suspended") { try { void x.ctx.resume().catch(() => {}); } catch {} }
    return x !== null;
  };

  const stop = (fade: number): void => {
    if (!x) return;
    endSession(x, amb, fade);
    endSession(x, mus, fade);
    amb = mus = null;
  };

  return {
    ensure,
    start(ambience, mood) {
      if (!ensure() || !x) return;
      stop(0.4);
      if (ambience !== null) {
        amb = session(x, ducked ? AMB_LEVEL.ducked : AMB_LEVEL.open);
        buildAmbience(x, amb, ambience);
      }
      if (mood !== null) {
        mus = session(x, ducked ? MUS_LEVEL.ducked : MUS_LEVEL.open);
        buildMusic(x, mus, mood);
      }
    },
    stop,
    duck(on) {
      ducked = on;
      if (!x) return;
      const t = x.ctx.currentTime;
      if (amb && !amb.dead) amb.bus.gain.setTargetAtTime(on ? AMB_LEVEL.ducked : AMB_LEVEL.open, t, 0.5);
      if (mus && !mus.dead) mus.bus.gain.setTargetAtTime(on ? MUS_LEVEL.ducked : MUS_LEVEL.open, t, 0.5);
    },
    chime() {
      if (!ensure() || !x) return;
      const s = session(x, 1, true);
      L.bell(x, s, 1, 660, 0.05, 0.5);
      L.bell(x, s, 1, 660, 0.65, 0.5);
      // let both strokes ring out, then free the nodes
      const owner = x;
      setTimeout(() => { endSession(owner, s, 0.4); }, 2500);
    },
    dispose() {
      stop(0.1);
      const c = x;
      x = null;
      failed = true;
      if (c) setTimeout(() => { void c.ctx.close().catch(() => {}); }, 1000);
    },
  };
}
