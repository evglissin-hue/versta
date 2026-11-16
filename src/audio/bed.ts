/** The bed (recorded and generated soundscape plus music) and the chime, on the graph's one AudioContext. */
import { type Graph, type Levels, createGraph } from "./graph";
import { type LoopLib, createLoopLib } from "./loops";
import { L, allLoops, buildAmbience, buildMusic, loopsFor } from "./soundscapes";
import { type Session, endSession, session } from "./synth";

export type Mood = "minor" | "bright";

/** Soundscape and music levels on the bed bus. The music sits under the soundscape. */
const AMB_LEVEL = 0.9;
const MUS_LEVEL = 0.55;
/** How long a starting soundscape waits for its recordings before it starts without them. */
const LOAD_WAIT_MS = 1500;

export interface Bed {
  /** Create or resume the context. Returns false where Web Audio is not available. */
  ensure(): boolean;
  /** The graph, once `ensure` has created it. */
  readonly graph: Graph | null;
  /** Fetch and decode every recorded loop in the background. */
  preload(): void;
  start(ambience: string | null, mood: Mood | null): void;
  stop(fadeSeconds: number): void;
  /** Two strokes of a ship's bell. */
  chime(): void;
  dispose(): void;
}

declare global { interface Window { __verstaAudio?: { levels(): Levels } } }

export function createBed(): Bed {
  let g: Graph | null = null;
  let loops: LoopLib | null = null;
  let failed = false;
  let amb: Session | null = null;
  let mus: Session | null = null;
  let startToken = 0;

  const ensure = (): boolean => {
    if (!g && !failed) {
      g = createGraph();
      if (!g) failed = true;
      else {
        const base = typeof import.meta.env?.BASE_URL === "string" ? import.meta.env.BASE_URL : "/";
        loops = createLoopLib(g.synth.ctx, base);
        const graph = g;
        if (typeof window !== "undefined") window.__verstaAudio = { levels: () => graph.levels() };
      }
    }
    if (g && g.synth.ctx.state === "suspended") { try { void g.synth.ctx.resume().catch(() => {}); } catch {} }
    return g !== null;
  };

  const stop = (fade: number): void => {
    startToken++;
    if (!g) return;
    endSession(g.synth, amb, fade);
    endSession(g.synth, mus, fade);
    amb = mus = null;
  };

  return {
    ensure,
    get graph() { return g; },
    preload() {
      if (!ensure() || !loops) return;
      void loops.load(allLoops());
    },
    start(ambience, mood) {
      if (!ensure() || !g || !loops) return;
      const x = g.synth, lib = loops;
      stop(0.4);
      const token = startToken;
      const go = (): void => {
        if (token !== startToken) return;
        if (ambience !== null) {
          amb = session(x, AMB_LEVEL);
          buildAmbience(x, amb, ambience, lib);
        }
        if (mood !== null) {
          mus = session(x, MUS_LEVEL);
          buildMusic(x, mus, mood);
        }
      };
      if (ambience === null) { go(); return; }
      let waited = false;
      const timer = setTimeout(() => { waited = true; go(); }, LOAD_WAIT_MS);
      void lib.load(loopsFor(ambience)).then(() => { if (!waited) { clearTimeout(timer); go(); } });
    },
    stop,
    chime() {
      if (!ensure() || !g) return;
      const x = g.synth;
      const s = session(x, 1, true);
      L.bell(x, s, 1, 660, 0.05, 0.5);
      L.bell(x, s, 1, 660, 0.65, 0.5);
      // let both strokes ring out, then free the nodes
      setTimeout(() => { endSession(x, s, 0.4); }, 2500);
    },
    dispose() {
      stop(0.1);
      const c = g;
      g = null;
      failed = true;
      if (typeof window !== "undefined") delete window.__verstaAudio;
      c?.dispose();
    },
  };
}
