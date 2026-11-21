/**
 * Recorded sounds under public/sounds, by path without ".mp3": fetched once (and kept in the Cache API for offline
 * rides), decoded once, made seamless where they loop.
 *   plain names (water): a soundscape loop, joined with an equal power crossfade
 *   music/<theme>: one loop plus a tail that repeats its start, joined with a linear crossfade (joinMusicLoop)
 *   fx/<name> and signals/<name>: one-shots, kept as decoded
 */

export const LOOP_CROSSFADE_SECONDS = 1.5;
export const MUSIC_TAIL_SECONDS = 1.5;
/** Decoded samples kept at most this large (bytes of Float32 data) before the least recently used go. */
export const MAX_DECODED_BYTES = 100 * 1024 * 1024;

/**
 * Make a recording loop without a seam: the last `fade` seconds are mixed into the first `fade` seconds with an
 * equal power crossfade, and the buffer is shortened by that amount. Pure array work, so it can be tested in Node.
 */
export function crossfadeLoop(channels: Float32Array[], sampleRate: number, fadeSeconds = LOOP_CROSSFADE_SECONDS): Float32Array[] {
  return channels.map((src) => {
    const fade = Math.min(Math.floor(fadeSeconds * sampleRate), Math.floor(src.length / 3));
    if (fade < 2) return src.slice();
    const len = src.length - fade;
    const out = new Float32Array(len);
    out.set(src.subarray(0, len));
    for (let i = 0; i < fade; i++) {
      const p = (i + 0.5) / fade;
      out[i] = src[i]! * Math.sin(p * Math.PI / 2) + src[len + i]! * Math.cos(p * Math.PI / 2);
    }
    return out;
  });
}

/**
 * Join a music file made of one loop plus a tail: the tail (the loop's start, with the ring-out of its end) is
 * faded out over the start with an equal gain (linear) crossfade, and dropped. Seamless when the file is a periodic
 * pattern plus its own continuation. Pure array work.
 */
export function joinMusicLoop(channels: Float32Array[], sampleRate: number, tailSeconds = MUSIC_TAIL_SECONDS): Float32Array[] {
  return channels.map((src) => {
    const tail = Math.floor(tailSeconds * sampleRate);
    if (tail < 2 || src.length < tail * 3) return src.slice();
    const len = src.length - tail;
    const out = new Float32Array(len);
    out.set(src.subarray(0, len));
    for (let i = 0; i < tail; i++) {
      const p = (i + 0.5) / tail;
      // at the seam the tail carries on from the loop's end; by the end of the fade the start carries on by itself
      out[i] = src[len + i]! * (1 - p) + src[i]! * p;
    }
    return out;
  });
}

export interface LoopLib {
  /** The decoded buffer (looped as its kind needs), or undefined until it has loaded (or if it never could). */
  get(name: string): AudioBuffer | undefined;
  /** Load these sounds. Resolves when every one has loaded or failed; never rejects. */
  load(names: string[]): Promise<void>;
}

const CACHE = "versta-sounds";

async function fetchBytes(url: string): Promise<ArrayBuffer> {
  let cache: Cache | null = null;
  try { cache = typeof caches !== "undefined" ? await caches.open(CACHE) : null; } catch { cache = null; }
  try {
    const hit = await cache?.match(url);
    if (hit) return await hit.arrayBuffer();
  } catch {}
  const res = await fetch(url);
  if (!res.ok) throw new Error(`sound ${res.status}`);
  try { if (cache) await cache.put(url, res.clone()); } catch {}
  return res.arrayBuffer();
}

interface Held { buf: AudioBuffer; bytes: number; used: number }

/** `inUse` names the sounds the playing bed holds: they are never dropped to make room. */
export function createLoopLib(ctx: AudioContext, base: string, inUse: () => Iterable<string> = () => []): LoopLib {
  const done = new Map<string, Held>();
  const pending = new Map<string, Promise<void>>();
  const failed = new Set<string>();
  let total = 0;
  let stamp = 0;

  const evict = (): void => {
    if (total <= MAX_DECODED_BYTES) return;
    const keep = new Set(inUse());
    const order = [...done.entries()].filter(([n]) => !keep.has(n)).sort((a, b) => a[1].used - b[1].used);
    for (const [name, h] of order) {
      if (total <= MAX_DECODED_BYTES) break;
      done.delete(name);
      total -= h.bytes;
    }
  };

  const shape = (name: string, raw: AudioBuffer): AudioBuffer => {
    if (name.startsWith("fx/") || name.startsWith("signals/")) return raw;
    const chans: Float32Array[] = [];
    for (let c = 0; c < raw.numberOfChannels; c++) chans.push(raw.getChannelData(c));
    const looped = name.startsWith("music/") ? joinMusicLoop(chans, raw.sampleRate) : crossfadeLoop(chans, raw.sampleRate);
    const buf = ctx.createBuffer(looped.length, looped[0]!.length, raw.sampleRate);
    looped.forEach((d, c) => buf.copyToChannel(d as Float32Array<ArrayBuffer>, c));
    return buf;
  };

  const one = (name: string): Promise<void> => {
    const have = done.get(name);
    if (have) { have.used = ++stamp; return Promise.resolve(); }
    if (failed.has(name)) return Promise.resolve();
    let p = pending.get(name);
    if (!p) {
      p = (async () => {
        try {
          const raw = await ctx.decodeAudioData(await fetchBytes(`${base}sounds/${name}.mp3`));
          const buf = shape(name, raw);
          const bytes = buf.length * buf.numberOfChannels * 4;
          done.set(name, { buf, bytes, used: ++stamp });
          total += bytes;
          evict();
        } catch {
          failed.add(name);
        } finally {
          pending.delete(name);
        }
      })();
      pending.set(name, p);
    }
    return p;
  };

  return {
    get(name) {
      const h = done.get(name);
      if (h) h.used = ++stamp;
      return h?.buf;
    },
    async load(names) { await Promise.all(names.map(one)); },
  };
}
