/**
 * The tour engine (task 34): generic, it knows nothing of rides. It holds a list of steps, shows one at a time and
 * says what is on screen. The overlay (Tour.tsx) draws it; the practice ride's steps live in practice.ts.
 */
import { signal } from "@preact/signals";

export type PictureName = "speaker" | "turn" | "mapbtn" | "dock" | "tap" | "pause" | "scene" | "mini" | "aside" | "flag";

export interface Step {
  id: string;
  /** The real part of the page to light up, or null while it is not there. */
  target: () => Element | null;
  title: string;
  line: string;
  picture: PictureName;
  /** Puts the page into the state this step needs. Idempotent: Next, Previous and coming back all call it. */
  enter?: () => void | Promise<void>;
  /** How long to wait for the target to appear, in milliseconds. */
  waitMs?: number;
  /** Let taps through to the lit part. */
  interactive?: boolean;
  /** True moves the tour on by itself, 600 ms later. */
  done?: () => boolean;
}

/** A centred card with no lit part: the intro, the end and a notice. */
export interface Card {
  id: string;
  picture: PictureName;
  title: string;
  line: string;
  actions: { label: string; primary?: boolean; run: () => void }[];
}

export type View = { kind: "closed" } | { kind: "card"; card: Card } | { kind: "step" };

export interface Box { x: number; y: number; w: number; h: number }

export const HOLE_PAD = 8;
export const CARD_MARGIN = 16;
export const CARD_MAX_W = 420;
const DONE_MS = 600;
const POLL_MS = 50;

/** The lit hole: the target's box grown by `pad` on every side. */
export function padBox(b: Box, pad = HOLE_PAD): Box {
  return { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
}

/**
 * Where the card goes: above or below the hole, whichever side has more room, `margin` from the screen edges, full
 * width up to `maxW`. It never overlaps the hole. When the side with more room is still too short for the card, the
 * card is cut to that room and `fits` is false: the caller then shrinks what is in it.
 */
export function placeCard(hole: Box, vp: { w: number; h: number }, card: { h: number }, margin = CARD_MARGIN, maxW = CARD_MAX_W): { x: number; y: number; w: number; h: number; side: "above" | "below"; fits: boolean } {
  const w = Math.min(maxW, vp.w - margin * 2);
  const x = Math.round((vp.w - w) / 2);
  const above = hole.y - margin * 2;
  const below = vp.h - (hole.y + hole.h) - margin * 2;
  const side = below >= above ? "below" : "above";
  const room = Math.max(0, side === "below" ? below : above);
  const fits = card.h <= room;
  const h = Math.min(card.h, room);
  const y = side === "below" ? hole.y + hole.h + margin : hole.y - margin - h;
  return { x, y: Math.round(y), w, h, side, fits };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class TourEngine {
  readonly view = signal<View>({ kind: "closed" });
  /** The steps still in the tour: a step whose target never came is taken out. */
  readonly steps = signal<Step[]>([]);
  readonly index = signal(0);
  /** The current step's target is on screen. */
  readonly ready = signal(false);
  /** A card's action is working (loading the route). */
  readonly busy = signal(false);
  /** Bumped on every step change so the overlay eases its hole once. */
  readonly changed = signal(0);
  /** Called when Next goes past the last step. */
  onEnd: () => void = () => {};
  private token = 0;
  private doneTimer: ReturnType<typeof setTimeout> | undefined;
  private poll: ReturnType<typeof setInterval> | undefined;

  get step(): Step | null { return this.view.value.kind === "step" ? this.steps.value[this.index.value] ?? null : null; }

  /** Show a card (centred, nothing lit). */
  card(c: Card): void { this.cancel(); this.busy.value = false; this.ready.value = false; this.view.value = { kind: "card", card: c }; }

  /** Run `steps` from the first one. */
  begin(steps: Step[]): void { this.steps.value = [...steps]; void this.go(0, 1); }

  next(): void { if (this.step) void this.go(this.index.value + 1, 1); }
  prev(): void { if (this.step && this.index.value > 0) void this.go(this.index.value - 1, -1); }

  /** Close everything. The caller (index.ts) puts the page back. */
  close(): void {
    this.cancel();
    this.busy.value = false; this.ready.value = false; this.steps.value = []; this.index.value = 0;
    this.view.value = { kind: "closed" };
  }

  /** Run the current step's `enter` again (the app came back to the front). */
  async reenter(): Promise<void> {
    const s = this.step;
    if (!s) return;
    try { await s.enter?.(); } catch { /* the target check shows what the page is like */ }
  }

  private cancel(): void {
    this.token++;
    clearTimeout(this.doneTimer); clearInterval(this.poll);
    this.doneTimer = undefined; this.poll = undefined;
  }

  private async go(i: number, dir: 1 | -1): Promise<void> {
    this.cancel();
    const my = this.token;
    const list = this.steps.value;
    if (i >= list.length) { this.ready.value = false; this.onEnd(); return; }
    if (i < 0) i = 0;
    const s = list[i]!;
    this.ready.value = false;
    this.index.value = i;
    this.view.value = { kind: "step" };
    this.changed.value++;
    try { await s.enter?.(); } catch { /* a failed enter leaves the target absent, and the step drops out */ }
    if (my !== this.token) return;
    const deadline = Date.now() + (s.waitMs ?? 0);
    while (!s.target()) {
      if (Date.now() >= deadline) {
        // the part is not there: the step drops out and the count goes without it
        this.steps.value = this.steps.value.filter((x) => x !== s);
        if (dir < 0 && i > 0) void this.go(i - 1, -1); else void this.go(i, 1);
        return;
      }
      await sleep(POLL_MS);
      if (my !== this.token) return;
    }
    this.ready.value = true;
    if (s.done) {
      let armed = false;
      this.poll = setInterval(() => {
        if (my !== this.token || armed || !s.done!()) return;
        armed = true;
        this.doneTimer = setTimeout(() => { if (my === this.token) this.next(); }, DONE_MS);
      }, 100);
    }
  }
}
