/**
 * Is the app running inside the Capacitor Android shell?
 * The shell injects `window.Capacitor` before any page script runs, so this needs no import and the browser bundle
 * stays free of native code.
 */
interface CapacitorGlobal { isNativePlatform?: () => boolean }

export function isNative(): boolean {
  const cap = (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor;
  try { return !!cap?.isNativePlatform?.(); } catch { return false; }
}
