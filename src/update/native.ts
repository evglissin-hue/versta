/**
 * The app's own native plugin for live updates of its web code (android/.../AppUpdatePlugin.java). Loaded with a
 * dynamic import so the browser build never contains Capacitor. Browser-only assumptions stay out of this file.
 */
import api from "./native-api.json";

/** The native API level this web code needs. */
export const NATIVE_API: number = api.level;

/** What the native side knows about the app's code on this phone. Bundle ids are versions: 16 hex characters. */
export interface UpdaterInfo {
  /** The APK's native API level. */
  level: number;
  versionCode: number;
  versionName: string;
  /** The downloaded bundle in use, or null for the APK's own code. */
  current: string | null;
  /** A downloaded bundle staged for the next start. */
  next: string | null;
  /** The bundle used before `current`, kept to fall back to. */
  previous: string | null;
  /** `current` has not yet said it started (ready()). */
  trial: boolean;
  /** Bundles that failed to start, or that the rider turned away from. Never staged again. */
  bad: string[];
}

export interface UpdaterApi {
  info(): Promise<UpdaterInfo>;
  /** Use bundle `id` (folder app/<id> in the data folder, with its index.html) from the next start. */
  stage(o: { id: string }): Promise<void>;
  /** Forget the staged bundle (a ride started): the next start keeps the code in use. */
  unstage(): Promise<void>;
  /** The running code has started properly: no rollback. */
  ready(): Promise<void>;
  /** Switch to the staged bundle now: the page reloads. */
  restart(): Promise<void>;
  /** Back to the APK's own code now, and never the current bundle again: the page reloads. */
  reset(): Promise<void>;
}

/** The plugin, or null outside the Android app or in an APK built before it existed. */
export async function loadUpdater(): Promise<UpdaterApi | null> {
  const { Capacitor, registerPlugin } = await import("@capacitor/core");
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable("AppUpdate")) return null;
  return registerPlugin<UpdaterApi>("AppUpdate");
}

/** Tell the native side this code started. Called once after the first render; never throws. */
export async function markReady(): Promise<void> {
  try { await (await loadUpdater())?.ready(); } catch { /* an APK without the plugin, or a plugin error: nothing to confirm */ }
}
