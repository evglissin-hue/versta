/**
 * Local notifications for the Android app: the ongoing ride notification (the next turn on the lock screen) and the
 * places notifications (task 30). Everything is a no-op in the browser. The plugin is loaded with a dynamic import so
 * the web build never contains it. Browser-only assumptions stay out of this file.
 */
import type { NavState, Pack } from "../types";
import { rideNoticeText, type NoticeText } from "../ui/notice";
import { isNative } from "./platform";

export const RIDE_NOTICE_ID = 1001;
export const RIDE_CHANNEL = "ride";
export const PLACES_CHANNEL = "places";
/** The distance change that makes the ride notification update, metres. */
export const NOTICE_STEP = 50;
/** The fewest milliseconds between two updates caused by a distance change. */
export const NOTICE_GAP_MS = 1000;
const ASKED_KEY = "versta.notifAsked";

/** The part of the plugin's API that we call. */
export interface NotifyApi {
  createChannel(channel: { id: string; name: string; importance: number; vibration?: boolean; sound?: string }): Promise<void>;
  schedule(options: { notifications: {
    id: number; title: string; body: string; channelId: string; ongoing?: boolean; autoCancel?: boolean; silent?: boolean;
    extra?: unknown;
  }[] }): Promise<unknown>;
  cancel(options: { notifications: { id: number }[] }): Promise<void>;
  checkPermissions(): Promise<{ display: string }>;
  requestPermissions(): Promise<{ display: string }>;
  addListener(event: "localNotificationActionPerformed", cb: (a: { notification: { extra?: unknown } }) => void): Promise<unknown>;
}

async function loadApi(): Promise<NotifyApi> {
  const { LocalNotifications } = await import("@capacitor/local-notifications");
  return LocalNotifications as unknown as NotifyApi;
}

export interface NotifyDeps {
  load?: () => Promise<NotifyApi>;
  native?: () => boolean;
  now?: () => number;
  /** Remembers that the permission was asked. */
  asked?: { get(): boolean; set(): void };
}

function storedAsked(): { get(): boolean; set(): void } {
  return {
    get() { try { return localStorage.getItem(ASKED_KEY) === "1"; } catch { return false; } },
    set() { try { localStorage.setItem(ASKED_KEY, "1"); } catch {} },
  };
}

export function createNotifier(deps: NotifyDeps = {}) {
  const load = deps.load ?? loadApi;
  const native = deps.native ?? isNative;
  const now = deps.now ?? Date.now;
  const asked = deps.asked ?? storedAsked();

  let api: Promise<NotifyApi> | null = null;
  const channels = new Set<string>();
  let permitted = true;
  let tapHandlers: ((extra: unknown) => void)[] = [];
  let tapListening = false;

  function get(): Promise<NotifyApi> {
    return (api ??= load());
  }

  async function channel(a: NotifyApi, id: string): Promise<void> {
    if (channels.has(id)) return;
    channels.add(id);
    try {
      if (id === RIDE_CHANNEL) await a.createChannel({ id, name: "Ride", importance: 2, vibration: false });
      else await a.createChannel({ id, name: "Places nearby", importance: 3 });
    } catch { channels.delete(id); }
  }

  /** Asks once (Android 13 and later). A refusal is final: the ride works without notifications. */
  async function ensurePermission(): Promise<boolean> {
    if (!native()) return false;
    try {
      const a = await get();
      const have = (await a.checkPermissions()).display;
      if (have === "granted") { permitted = true; return true; }
      if (have === "denied" || asked.get()) { permitted = false; return false; }
      asked.set();
      permitted = (await a.requestPermissions()).display === "granted";
      return permitted;
    } catch { permitted = false; return false; }
  }

  // The ride notification.
  let shown: NoticeText | null = null;
  let shownAt = 0;
  let live = false;

  async function show(text: { title: string; body: string }): Promise<void> {
    if (!native() || !permitted) return;
    try {
      const a = await get();
      await channel(a, RIDE_CHANNEL);
      await a.schedule({ notifications: [{
        id: RIDE_NOTICE_ID, title: text.title, body: text.body, channelId: RIDE_CHANNEL, ongoing: true, autoCancel: false, silent: true,
      }] });
      live = true;
    } catch {}
  }

  async function clear(): Promise<void> {
    shown = null;
    if (!native() || !live) return;
    live = false;
    try { await (await get()).cancel({ notifications: [{ id: RIDE_NOTICE_ID }] }); } catch {}
  }

  /** Builds the text for this nav state and shows it when it changed enough. Returns whether it showed. */
  function update(nav: NavState, pack: Pack | null): boolean {
    if (!native()) return false;
    const text = rideNoticeText(nav, pack);
    if (!text) { if (shown) void clear(); return false; }
    const t = now();
    const prev = shown;
    if (prev) {
      const sameTitle = prev.title === text.title;
      const stepped = prev.dist !== null && text.dist !== null && Math.abs(prev.dist - text.dist) >= NOTICE_STEP;
      const kindChanged = (prev.dist === null) !== (text.dist === null);
      const bodyChanged = prev.dist === null && text.dist === null && prev.body !== text.body;
      if (sameTitle && !stepped && !kindChanged && !bodyChanged) return false;
      // A new turn or status shows at once; a distance change waits for the gap.
      if (sameTitle && !bodyChanged && !kindChanged && t - shownAt < NOTICE_GAP_MS) return false;
    }
    shown = text;
    shownAt = t;
    void show(text);
    return true;
  }

  async function placeNotice(id: number, title: string, body: string, extra?: unknown): Promise<void> {
    if (!native() || !permitted) return;
    try {
      const a = await get();
      await channel(a, PLACES_CHANNEL);
      await a.schedule({ notifications: [{ id, title, body, channelId: PLACES_CHANNEL, autoCancel: true, extra }] });
    } catch {}
  }

  /** Calls back with the `extra` of a places notification when it is tapped. Returns a function that stops listening. */
  function onNoticeTap(handler: (extra: unknown) => void): () => void {
    if (!native()) return () => {};
    tapHandlers.push(handler);
    if (!tapListening) {
      tapListening = true;
      void get().then((a) => a.addListener("localNotificationActionPerformed", (action) => {
        const extra = action.notification.extra;
        // The ride notification carries no extra: tapping it only opens the app.
        if (extra === undefined || extra === null) return;
        for (const h of tapHandlers) h(extra);
      })).catch(() => { tapListening = false; });
    }
    return () => { tapHandlers = tapHandlers.filter((h) => h !== handler); };
  }

  return { ensurePermission, placeNotice, onNoticeTap, rideNotice: { show, update, clear } };
}

const notifier = createNotifier();
export const ensurePermission = notifier.ensurePermission;
export const placeNotice = notifier.placeNotice;
export const onNoticeTap = notifier.onNoticeTap;
export const rideNotice = notifier.rideNotice;
