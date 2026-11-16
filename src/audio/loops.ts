/** Recorded soundscape loops: fetched once (and kept in the Cache API for offline rides), decoded once, made seamless. */

export const LOOP_CROSSFADE_SECONDS = 1.5;

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

export interface LoopLib {
  /** The decoded, loopable buffer, or undefined until it has loaded (or if it never could). */
  get(name: string): AudioBuffer | undefined;
  /** Load these loops. Resolves when every one has loaded or failed; never rejects. */
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

export function createLoopLib(ctx: AudioContext, base: string): LoopLib {
  const done = new Map<string, AudioBuffer>();
  const pending = new Map<string, Promise<void>>();
  const failed = new Set<string>();

  const one = (name: string): Promise<void> => {
    if (done.has(name) || failed.has(name)) return Promise.resolve();
    let p = pending.get(name);
    if (!p) {
      p = (async () => {
        try {
          const raw = await ctx.decodeAudioData(await fetchBytes(`${base}sounds/${name}.mp3`));
          const chans: Float32Array[] = [];
          for (let c = 0; c < raw.numberOfChannels; c++) chans.push(raw.getChannelData(c));
          const looped = crossfadeLoop(chans, raw.sampleRate);
          const buf = ctx.createBuffer(looped.length, looped[0]!.length, raw.sampleRate);
          looped.forEach((d, c) => buf.copyToChannel(d as Float32Array<ArrayBuffer>, c));
          done.set(name, buf);
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
    get: (name) => done.get(name),
    async load(names) { await Promise.all(names.map(one)); },
  };
}
