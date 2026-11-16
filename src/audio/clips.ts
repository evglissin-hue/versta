/** One clip on one channel, either a real HTMLAudioElement or a timer standing in for it (virtual mode). */

export interface ClipCallbacks {
  onEnd(): void;
  onError(): void;
  onTime?(seconds: number): void;
}

export interface Clip {
  /** Start, or resume after `pause`. */
  play(): void;
  pause(): void;
  /** Silence and detach. No callback fires after this. */
  dispose(): void;
}

export type ClipFactory = (src: string, estimatedSeconds: number | undefined, cb: ClipCallbacks) => Clip;

const TICK_MS = 250;
const DEFAULT_SECONDS = 3;

/** A clip that "plays" for estimatedSeconds / timeScale real seconds. Runs under Node. */
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
    return {
      play() {
        if (dead || playing) return;
        playing = true;
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
      },
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

/** A clip on a shared, already unlocked audio element. */
export function elementClipFactory(el: HTMLAudioElement, resolve: (src: string) => string): ClipFactory {
  return (src, _est, cb) => {
    let started = false;
    let dead = false;
    let paused = false;
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
    return {
      play() {
        if (dead) return;
        paused = false;
        if (!started) {
          started = true;
          el.addEventListener("ended", onEnded);
          el.addEventListener("error", fail);
          el.src = resolve(src);
        }
        let p: Promise<void> | undefined;
        try { p = el.play(); } catch { fail(); return; }
        p?.catch(() => { if (!paused && !dead) fail(); });
        if (cb.onTime && !tick) tick = setInterval(() => { if (!dead && !el.paused) cb.onTime?.(el.currentTime); }, TICK_MS);
      },
      pause() {
        if (dead) return;
        paused = true;
        clearInterval(tick);
        tick = undefined;
        try { el.pause(); } catch {}
      },
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
