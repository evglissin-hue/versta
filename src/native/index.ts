/**
 * Native shell bootstrap. `main.tsx` calls `initNative()` once at start. In a browser it does nothing.
 * Inside the Android app it removes the service worker (not needed there) and takes over the back button.
 */
import { openStop, screen } from "../state";
import { isNative } from "./platform";

/** Fired on `window` when the Android back button is pressed. A screen that closes something calls `preventDefault()`. */
export const BACK_EVENT = "versta:back";

/** What the back button does. Returns what happened, for tests. */
export function handleBack(minimize: () => void): "handled-by-ui" | "closed-sheet" | "stayed-in-ride" | "minimized" {
  const ev = new CustomEvent(BACK_EVENT, { cancelable: true });
  window.dispatchEvent(ev);
  if (ev.defaultPrevented) return "handled-by-ui";
  if (openStop.value !== null) { openStop.value = null; return "closed-sheet"; }
  // A ride is never left silently: the rider ends it with the on-screen button.
  if (screen.value === "ride") return "stayed-in-ride";
  // Home screen: send the app to the background instead of exiting it.
  minimize();
  return "minimized";
}

async function removeServiceWorkers(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
  } catch {}
}

export function initNative(): void {
  if (!isNative()) return;
  // The packs and the app shell ship inside the APK, so the service worker has nothing to do. Block its registration
  // (registerSW.js calls this) and remove any left behind.
  if ("serviceWorker" in navigator) {
    try { Object.defineProperty(navigator.serviceWorker, "register", { value: () => new Promise(() => {}), configurable: true }); } catch {}
  }
  void removeServiceWorkers();
  // Pocket alerts: listen for taps on place notifications (a cold start from a tap too), and resume the watch if it
  // was on and has not expired.
  void import("../places/watch").then((m) => m.initPlaceWatch()).catch(() => {});
  // No ride runs at launch: a ride notice still showing was left by an app Android killed mid-ride. Clear it.
  void import("./notify").then((m) => m.rideNotice.clear()).catch(() => {});
  void import("@capacitor/app").then(({ App }) => {
    void App.addListener("resume", () => {
      void import("../routes/store").then((m) => m.routeStore.check());
      void import("../update/store").then((m) => m.appStore.check()).catch(() => {});
    });
    void App.addListener("backButton", () => { handleBack(() => { void App.minimizeApp(); }); });
  }).catch(() => {});
}
