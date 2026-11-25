import { cumulative, makeProjection, pointAlong, project, unproject, type XY } from "../geo";
import { createNativeGpsSource } from "../native/gps";
import { createJitter, type JitterProfile } from "./jitter";
import { isNative } from "../native/platform";
import { UNKNOWN_ACCURACY, type Fix, type FixSource, type GpsError, type Pack } from "../types";

/** Which device GPS the app uses: the background plugin inside the Android app, the browser API anywhere else. */
export function gpsKind(): "native" | "browser" {
  return isNative() ? "native" : "browser";
}

/** The device GPS: native background location in the Android app, the browser Geolocation API otherwise. */
export function createGpsSource(): FixSource {
  return gpsKind() === "native" ? createNativeGpsSource() : createBrowserGpsSource();
}

/** The device GPS through the browser Geolocation API. */
export function createBrowserGpsSource(): FixSource {
  let watch: number | null = null;
  return {
    start(onFix, onError) {
      if (typeof navigator === "undefined" || !navigator.geolocation) { onError("unsupported"); return; }
      watch = navigator.geolocation.watchPosition(
        (pos) => {
          const c = pos.coords;
          onFix({
            lng: c.longitude,
            lat: c.latitude,
            accuracy: Number.isFinite(c.accuracy) && c.accuracy > 0 ? c.accuracy : UNKNOWN_ACCURACY,
            heading: c.heading === null || Number.isNaN(c.heading) ? null : c.heading,
            speed: c.speed === null || Number.isNaN(c.speed) ? null : c.speed,
            time: pos.timestamp,
            receivedAt: Date.now(),
          });
        },
        (err) => {
          const code: GpsError = err.code === 1 ? "denied" : err.code === 3 ? "timeout" : "unavailable";
          onError(code);
        },
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 },
      );
    },
    stop() {
      if (watch !== null && typeof navigator !== "undefined" && navigator.geolocation) navigator.geolocation.clearWatch(watch);
      watch = null;
    },
  };
}

/** Small seeded generator so simulated rides are repeatable. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SIM_EPOCH = 1_700_000_000_000;
const TICK_MS = 100;
const SIM_JITTER = 3;
const SIM_ACCURACY = 6;

/**
 * A simulated rider that follows the pack's line from stop `from` to the end.
 * `speed` is metres per simulated second, `scale` is simulated seconds per real second. `jitter` puts the fixes
 * through the GPS model of src/nav/jitter.ts (urban multipath, lying accuracy, stale and missing fixes), seeded.
 */
export function createSimSource(pack: Pack, opts: { speed: number; scale: number; from: number; jitter?: JitterProfile | null; seed?: number }): FixSource {
  const proj = makeProjection(pack.stops[0]!.at);
  const from = Math.max(0, Math.min(pack.stops.length - 1, Math.floor(opts.from)));
  const path: XY[] = [project(proj, pack.stops[from]!.at)];
  for (let i = from + 1; i < pack.segments.length; i++) {
    for (const q of pack.segments[i] ?? []) {
      const xy = project(proj, q);
      const last = path[path.length - 1]!;
      if (xy[0] !== last[0] || xy[1] !== last[1]) path.push(xy);
    }
  }
  const cum = cumulative(path);
  const length = cum[cum.length - 1]!;
  const rand = mulberry32(0x7e57a1);
  const model = opts.jitter ? createJitter(opts.seed ?? 1, opts.jitter) : null;

  let timer: ReturnType<typeof setInterval> | null = null;
  let simSeconds = 0;
  let travelled = 0;
  let held = false;
  let ticks = 0;

  function makeFixes(): Fix[] {
    const pa = pointAlong(path, travelled, cum);
    const time = SIM_EPOCH + simSeconds * 1000;
    if (model) {
      const still = held || travelled >= length;
      return model.next({ p: pa.point, time, speed: still ? 0 : opts.speed, heading: still ? null : pa.bearing }).map((r) => {
        const ll = unproject(proj, r.p);
        return { lng: ll[0], lat: ll[1], accuracy: r.accuracy, heading: r.heading, speed: r.speed, time: r.time, receivedAt: r.receivedAt };
      });
    }
    const angle = rand() * Math.PI * 2;
    const radius = rand() * SIM_JITTER;
    const xy: XY = [pa.point[0] + Math.cos(angle) * radius, pa.point[1] + Math.sin(angle) * radius];
    const ll = unproject(proj, xy);
    return [{ lng: ll[0], lat: ll[1], accuracy: SIM_ACCURACY, heading: pa.bearing, speed: opts.speed, time, receivedAt: time }];
  }

  return {
    start(onFix) {
      if (timer !== null) return;
      timer = setInterval(() => {
        ticks += 1;
        const due = Math.floor((ticks * opts.scale * TICK_MS) / 1000 + 1e-6);
        while (simSeconds < due) {
          simSeconds += 1;
          if (!held) travelled = Math.min(length, travelled + opts.speed);
          for (const f of makeFixes()) onFix(f);
        }
      }, TICK_MS);
    },
    stop() {
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
    hold(on: boolean) { held = on; },
    now() { return SIM_EPOCH + simSeconds * 1000; },
  };
}
