/**
 * Checks on the sound timeline the mixer records (SoundEvent), shared by the dead-end hunts. Pure functions: they
 * take the timeline and what the ride did, and return a list of problems, empty when all is well.
 */
import type { DirectorLogEntry, Pack, SoundEvent } from "../../src/types";

export interface Interval { ch: SoundEvent["ch"]; src: string; on: number; off: number; onPos?: number; offPos?: number; ended?: boolean }

const SPEECH: SoundEvent["ch"][] = ["voice", "nav", "signal"];

/**
 * Pair every `on` with its `off`. Voice, nav and signal are paired per channel in order (one at a time); the bed
 * layers and effects are paired by channel and name. An `on` with no `off` comes back in `open`.
 */
export function intervals(tl: readonly SoundEvent[]): { list: Interval[]; open: Interval[] } {
  const list: Interval[] = [];
  const pending = new Map<string, Interval[]>();
  const key = (e: SoundEvent): string => (SPEECH.includes(e.ch) ? e.ch : `${e.ch}|${e.src}`);
  for (const e of tl) {
    const k = key(e);
    const q = pending.get(k) ?? [];
    if (e.ev === "on") {
      const iv: Interval = { ch: e.ch, src: e.src, on: e.at, off: Infinity };
      if (e.pos !== undefined) iv.onPos = e.pos;
      q.push(iv);
      pending.set(k, q);
    } else {
      const iv = q.shift();
      if (!iv) continue;
      iv.off = e.at;
      if (e.pos !== undefined) iv.offPos = e.pos;
      if (e.ended) iv.ended = true;
      list.push(iv);
    }
  }
  const open = [...pending.values()].flat();
  return { list: list.sort((a, b) => a.on - b.on), open };
}

const sec = (ms: number, t0: number): string => `${((ms - t0) / 1000).toFixed(1)} s`;

/** No two speech sounds (voice, nav, signal) are heard at the same time. */
export function speechOverlaps(tl: readonly SoundEvent[], t0 = 0): string[] {
  const { list, open } = intervals(tl);
  const speech = [...list, ...open].filter((i) => SPEECH.includes(i.ch)).sort((a, b) => a.on - b.on);
  const out: string[] = [];
  for (let i = 0; i < speech.length; i++) {
    for (let j = i + 1; j < speech.length && speech[j]!.on < speech[i]!.off; j++) {
      const a = speech[i]!, b = speech[j]!;
      if (b.on < a.off && a.on < b.off) out.push(`${b.ch} ${b.src} at ${sec(b.on, t0)} over ${a.ch} ${a.src} (${sec(a.on, t0)} to ${sec(a.off, t0)})`);
    }
  }
  return out;
}

/** Every spoken cue starts (its distance call, or the cue itself) within `maxMs` of the moment it was decided. */
export function lateCues(tl: readonly SoundEvent[], log: readonly DirectorLogEntry[], pack: Pack, maxMs = 3500, t0 = 0): string[] {
  const out: string[] = [];
  const distances = new Set(Object.values(pack.system.distances ?? {}));
  const navOn = tl.filter((e) => e.ch === "nav" && e.ev === "on");
  for (const e of log) {
    if (e.what !== "cue_spoken" || !e.id) continue;
    const cue = pack.cues.find((c) => c.id === e.id);
    if (!cue) continue;
    const first = navOn.find((n) => n.at >= e.at && (n.src === cue.audio || distances.has(n.src)));
    const own = navOn.find((n) => n.at >= e.at && n.src === cue.audio);
    if (!own) { out.push(`${cue.id} decided at ${sec(e.at, t0)} never sounded`); continue; }
    // cues decided at the same moment (a depart and the turn just after it) are one spoken sequence: it counts from
    // when the sequence starts
    const together = log.some((x) => x !== e && x.what === "cue_spoken" && x.at === e.at && log.indexOf(x) < log.indexOf(e));
    const seq = together ? navOn.find((n) => n.at >= e.at) : undefined;
    const start = seq ? seq.at : first && first.at <= own.at ? first.at : own.at;
    if (start - e.at > maxMs) out.push(`${cue.id} decided at ${sec(e.at, t0)} started ${((start - e.at) / 1000).toFixed(1)} s later`);
  }
  return out;
}

/**
 * The bed never outlives the stop: every ambience and music layer that was sounding when the rider left a stop is
 * silent within `maxMs`.
 */
export function bedAfterLeave(tl: readonly SoundEvent[], leaves: readonly number[], maxMs = 30_000, t0 = 0): string[] {
  const { list, open } = intervals(tl);
  const bed = [...list, ...open].filter((i) => i.ch === "ambience" || i.ch === "music");
  const out: string[] = [];
  for (const t of leaves) {
    for (const b of bed) {
      if (b.on <= t && b.off > t + maxMs) out.push(`${b.ch} ${b.src} still sounding ${((Math.min(b.off, Infinity) - t) / 1000).toFixed(0)} s after leaving a stop at ${sec(t, t0)}`);
    }
  }
  return out;
}

/** Effects of every story that played to its end fired once each, within `tolS` of their place on the clip. */
export function effectProblems(tl: readonly SoundEvent[], log: readonly DirectorLogEntry[], pack: Pack, tolS = 0.5): string[] {
  const out: string[] = [];
  const stories = new Map(pack.stops.flatMap((s) => s.stories).map((s) => [s.id, s] as const));
  const ended = new Set(log.filter((e) => e.what === "story_end").map((e) => e.id));
  const started = log.filter((e) => e.what === "story_start").map((e) => e.id!);
  const voiceOn = tl.filter((e) => e.ch === "voice" && e.ev === "on");
  const effectOn = tl.filter((e) => e.ch === "effect" && e.ev === "on");
  for (const id of new Set(started)) {
    const story = stories.get(id);
    if (!story?.sfx?.length || !story.audio || !ended.has(id)) continue;
    const fired = log.filter((e) => e.what === "effect" && e.id === id);
    for (const fx of story.sfx) {
      const mine = fired.filter((e) => e.reason === `${fx.para}:${fx.name}`);
      const plays = started.filter((s) => s === id).length;
      if (mine.length !== plays) { out.push(`${id} effect ${fx.name} before paragraph ${fx.para} fired ${mine.length} times in ${plays} plays`); continue; }
      const place = Math.max(0, (story.audio.marks[fx.para] ?? 0) - 1.2);
      for (const m of mine) {
        const sound = effectOn.find((e) => e.src === fx.name && Math.abs(e.at - m.at) < 1500);
        if (!sound) { out.push(`${id} effect ${fx.name} was logged but never sounded`); continue; }
        const v = [...voiceOn].reverse().find((e) => e.src === story.audio!.src && e.at <= sound.at);
        if (!v || v.pos === undefined) continue;
        const head = v.pos + (sound.at - v.at) / 1000;
        if (Math.abs(head - place) > tolS) out.push(`${id} effect ${fx.name} fired at ${head.toFixed(2)} s of the clip, its place is ${place.toFixed(2)} s`);
      }
    }
  }
  return out;
}

/**
 * A cue decided while the narration was sounding, that waited for a phrase break (its utterance, the distance call or
 * else the cue, started more than 0.3 s after it was decided), still ends `minMs` before its turn.
 */
export function waitedTooLong(tl: readonly SoundEvent[], log: readonly DirectorLogEntry[], pack: Pack, turnAt: ReadonlyMap<string, number>, minMs = 5000, t0 = 0): string[] {
  const out: string[] = [];
  const { list } = intervals(tl);
  const distances = new Set(Object.values(pack.system.distances ?? {}));
  for (const e of log) {
    if (e.what !== "cue_spoken" || !e.id) continue;
    const cue = pack.cues.find((c) => c.id === e.id);
    const turn = turnAt.get(e.id);
    if (!cue || turn === undefined || cue.turn === "depart") continue;
    // only a cue decided while the narration was sounding can have waited for a phrase break
    if (!list.some((i) => i.ch === "voice" && i.on <= e.at && i.off > e.at)) continue;
    const own = list.find((i) => i.ch === "nav" && i.src === cue.audio && i.on >= e.at);
    if (!own) continue;
    const call = list.find((i) => i.ch === "nav" && distances.has(i.src) && i.on >= e.at && i.off <= own.on + 200);
    const start = call && call.on <= own.on ? call.on : own.on;
    if (start - e.at <= 300) continue;
    if (own.off > turn - minMs) out.push(`${cue.id} waited ${((start - e.at) / 1000).toFixed(1)} s and ended ${((turn - own.off) / 1000).toFixed(1)} s before its turn at ${sec(turn, t0)}`);
  }
  return out;
}

/**
 * Narration that yielded to the nav channel comes back within `maxMs` of the queue emptying. `deliberate` holds the
 * times the director stopped, replaced or paused the voice: those are not yields.
 */
export function heldVoice(tl: readonly SoundEvent[], deliberate: readonly number[], maxMs = 1000, t0 = 0): string[] {
  const { list } = intervals(tl);
  const voice = list.filter((i) => i.ch === "voice");
  const navs = list.filter((i) => i.ch === "nav" || i.ch === "signal");
  const out: string[] = [];
  for (const v of voice) {
    if (!Number.isFinite(v.off) || v.ended) continue;
    const first = navs.find((n) => n.on >= v.off && n.on - v.off <= 500);
    if (!first) continue;
    if (deliberate.some((t) => t >= v.on && t <= v.off + 500)) continue;
    let end = first.off;
    for (const n of navs) if (n.on > first.on && n.on <= end + 300) end = Math.max(end, n.off);
    if (deliberate.some((t) => t > v.off && t <= end + maxMs)) continue;
    const back = voice.find((w) => w.src === v.src && w.on >= end && w.on <= end + maxMs);
    if (!back) out.push(`${v.src} yielded at ${sec(v.off, t0)} and did not resume within ${maxMs / 1000} s of the nav queue emptying at ${sec(end, t0)}`);
  }
  return out;
}
