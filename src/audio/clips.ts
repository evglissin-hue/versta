/** One clip on one channel, either a real HTMLAudioElement or a timer standing in for it (virtual mode). */

export interface ClipCallbacks {
  onEnd(): void;
  onError(): void;
  onTime?(seconds: number): void;
}

export interface Clip {
  /** Start, or resume after `pause`, from the current playhead. */
  play(): void;
  pause(): void;
  /** Move the playhead to this many seconds from the start (clamped), whether playing, paused or not yet started. */
  seekTo(seconds: number): void;
  /** The playhead in seconds. */
  position(): number;
  /** Length in seconds; Infinity while unknown. */
  duration(): number;
  /** Silence and detach. No callback fires after this. */
  dispose(): void;
}

export type ClipFactory = (src: string, estimatedSeconds: number | undefined, cb: ClipCallbacks) => Clip;

const TICK_MS = 250;
const DEFAULT_SECONDS = 3;

/**
 * A clip that "plays" for estimatedSeconds / timeScale real seconds. Runs under Node. The playhead is modelled
 * exactly: it reports its position, seeks to an absolute second and ends when it reaches the end.
 */
export function virtualClipFactory(timeScale: number): ClipFactory {
  const scale = timeScale > 0 ? timeScale : 1;
  return (_src, estimatedSeconds, cb) => {
    const total = estimatedSeconds && estimatedSeconds > 0 ? estimatedSeconds : DEFAULT_SECONDS;
    const totalMs = (total / scale) * 1000;
    let elapsedMs = 0;
    let startedAt = 0;
    let playing = false;
    let dead = false;
    let endTimer: ReturnType<typeof setTimeout> | undefined;
    let tick: ReturnType<typeof setInterval> | undefined;
    const clear = (): void => { clearTimeout(endTimer); clearInterval(tick); endTimer = tick = undefined; };
    const head = (): number => Math.min(total, ((elapsedMs + (playing ? Date.now() - startedAt : 0)) / 1000) * scale);
    const arm = (): void => {
      startedAt = Date.now();
      endTimer = setTimeout(() => {
        if (dead) return;
        clear();
        playing = false;
        elapsedMs = totalMs;
        cb.onTime?.(total);
        dead = true;
        cb.onEnd();
      }, Math.max(0, totalMs - elapsedMs));
      if (cb.onTime) tick = setInterval(() => { if (!dead) cb.onTime?.(head()); }, TICK_MS);
    };
    return {
      play() {
        if (dead || playing) return;
        playing = true;
        arm();
      },
      seekTo(seconds) {
        if (dead) return;
        const to = Math.min(totalMs, Math.max(0, (seconds * 1000) / scale));
        if (playing) clear();
        elapsedMs = to;
        if (playing) arm();
      },
      position: head,
      duration: () => total,
      pause() {
        if (dead || !playing) return;
        elapsedMs += Date.now() - startedAt;
        playing = false;
        clear();
      },
      dispose() { dead = true; playing = false; clear(); },
    };
  };
}

/** Where an element's source was last set, so a clip can tell that its sound is already loaded. */
const loadedSrc = new WeakMap<HTMLAudioElement, string>();

/** Load a sound on an idle element ahead of its turn (the second nav element does this for the next cue). */
export function prepareElement(el: HTMLAudioElement, url: string): void {
  if (loadedSrc.get(el) === url) return;
  loadedSrc.set(el, url);
  try {
    el.preload = "auto";
    el.src = url;
    el.load();
  } catch {}
}

/** A clip on a shared, already unlocked audio element. */
export function elementClipFactory(el: HTMLAudioElement, resolve: (src: string) => string): ClipFactory {
  return (src, _est, cb) => {
    let started = false;
    let dead = false;
    let paused = false;
    let startAt = 0;
    let tick: ReturnType<typeof setInterval> | undefined;
    const fail = (): void => { if (dead) return; dispose(); cb.onError(); };
    const onEnded = (): void => { if (dead) return; cb.onTime?.(el.currentTime); dispose(); cb.onEnd(); };
    const dispose = (): void => {
      dead = true;
      clearInterval(tick);
      tick = undefined;
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("error", fail);
      try { el.pause(); } catch {}
    };
    const go = (): void => {
      if (dead || paused) return;
      let p: Promise<void> | undefined;
      try { p = el.play(); } catch { fail(); return; }
      p?.catch(() => { if (!paused && !dead) fail(); });
      if (cb.onTime && !tick) tick = setInterval(() => { if (!dead && !el.paused) cb.onTime?.(el.currentTime); }, TICK_MS);
    };
    return {
      play() {
        if (dead) return;
        paused = false;
        if (!started) {
          started = true;
          el.addEventListener("ended", onEnded);
          el.addEventListener("error", fail);
          const url = resolve(src);
          if (loadedSrc.get(el) !== url) { loadedSrc.set(el, url); el.src = url; }
          if (el.readyState >= 1) {
            // already loaded (prepared, or the same sound as last time): start from the right place, not where it stopped
            try { el.currentTime = startAt; } catch {}
          } else if (startAt > 0) {
            // a playhead set before the metadata is there is ignored by some browsers: wait for it
            el.addEventListener("loadedmetadata", () => {
              if (dead) return;
              try { el.currentTime = startAt; } catch {}
              go();
            }, { once: true });
            return;
          }
        }
        go();
      },
      pause() {
        if (dead) return;
        paused = true;
        clearInterval(tick);
        tick = undefined;
        try { el.pause(); } catch {}
      },
      seekTo(seconds) {
        if (dead) return;
        const length = Number.isFinite(el.duration) ? el.duration : Infinity;
        const to = Math.min(length, Math.max(0, seconds));
        if (!started || el.readyState < 1) { startAt = to; return; }
        try { el.currentTime = to; } catch {}
      },
      position: () => (started && el.readyState >= 1 ? el.currentTime : startAt),
      duration: () => (Number.isFinite(el.duration) ? el.duration : Infinity),
      dispose,
    };
  };
}

/** A 0.1 s silent WAV, used to unlock audio elements from a tap. */
export function silentWavUri(): string {
  const samples = 800;
  const bytes = new Uint8Array(44 + samples * 2);
  const v = new DataView(bytes.buffer);
  const tag = (o: number, s: string): void => { for (let i = 0; i < s.length; i++) bytes[o + i] = s.charCodeAt(i); };
  tag(0, "RIFF"); v.setUint32(4, 36 + samples * 2, true); tag(8, "WAVE"); tag(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true);
  v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); tag(36, "data"); v.setUint32(40, samples * 2, true);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `data:audio/wav;base64,${btoa(bin)}`;
}
