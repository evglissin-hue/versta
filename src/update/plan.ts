/**
 * The app update's decisions, pure: which version of the app's code runs, whether the site has a newer one this
 * phone can use, and what to do next. No browser, no Capacitor, no clock. `store.ts` feeds it and runs the answer.
 */
import type { AppUpdateStatus, AppVersion, Transfer } from "../types";
import type { UpdaterInfo } from "./native";

/** dist/app/manifest.json, written by tools/app_manifest.mjs at every build. */
export interface AppManifest {
  /** First 16 hex of the sha256 of the sorted "path:sha256" lines. */
  version: string;
  builtAt: string;
  /** The native API level the code needs (src/update/native-api.json). */
  native: number;
  commit: string | null;
  /** Every file of the Android web bundle except the routes, paths relative to the app's root. */
  files: { path: string; bytes: number; sha256: string }[];
}

/** A bundle downloaded whole and checked (`versta:app-bundles`). */
export interface BundleRecord { builtAt: string; native: number }

export interface AppPlanInput {
  /** The APK's own manifest (its app/manifest.json), or null when it cannot be read. */
  builtIn: Pick<AppManifest, "version" | "builtAt"> | null;
  /** The native plugin's state, or null in an APK without it: then nothing is ever downloaded. */
  info: UpdaterInfo | null;
  /** Bundles downloaded whole, by version. */
  record: Record<string, BundleRecord>;
  /** The site's manifest, or null when it could not be read. */
  site: AppManifest | null;
  riding: boolean;
  wifi: boolean;
  /** The rider tapped Download or Try again this session. */
  wanted: boolean;
  /** A download in hand or stopped, of `site.version`. */
  transfer: Transfer | null;
  /** What downloading `site.version` costs, once worked out. */
  cost: number | null;
}

export type AppAction =
  | { kind: "none" }
  | { kind: "download"; version: string }
  /** The site's version is downloaded whole: stage it for the next start. */
  | { kind: "stage"; version: string }
  /** A ride runs: take the staged version off, so a restart mid-ride keeps the code in use. */
  | { kind: "unstage" };

export interface AppPlan { running: AppVersion | null; status: AppUpdateStatus; action: AppAction }

const stamp = (s: string | undefined): number => { const t = s ? Date.parse(s) : NaN; return Number.isFinite(t) ? t : 0; };

/** The version in use: the downloaded bundle the plugin names, else the APK's own. */
export function runningVersion(builtIn: AppPlanInput["builtIn"], info: UpdaterInfo | null, record: Record<string, BundleRecord>): AppVersion | null {
  const cur = info?.current ?? null;
  if (cur) return { version: cur, builtAt: record[cur]?.builtAt ?? "", source: "downloaded" };
  return builtIn ? { version: builtIn.version, builtAt: builtIn.builtAt, source: "installed" } : null;
}

export function planApp(input: AppPlanInput): AppPlan {
  const { builtIn, info, record, site, riding, wifi, wanted, transfer, cost } = input;
  const running = runningVersion(builtIn, info, record);
  const none = (action: AppAction = { kind: "none" }): AppPlan => ({ running, status: { kind: "none" }, action });
  if (!info || !running) return none();
  const staged = info.next && !info.bad.includes(info.next) && info.next !== running.version ? info.next : null;
  // a ride never runs with a staged version waiting: Android may restart the app mid-ride
  if (riding && staged) return { running, status: { kind: "ready" }, action: { kind: "unstage" } };

  const newer = !!site && site.version !== running.version && stamp(site.builtAt) > stamp(running.builtAt) && !info.bad.includes(site.version);
  if (!newer || !site) {
    // the site cannot be read, or has nothing newer: a version staged earlier still starts next time
    return staged ? { running, status: { kind: "ready" }, action: { kind: "none" } } : none();
  }
  if (site.native > info.level) return { running, status: { kind: "needs-app" }, action: { kind: "none" } };
  if (staged === site.version) return { running, status: { kind: "ready" }, action: { kind: "none" } };
  const bytes = cost ?? site.files.reduce((n, f) => n + f.bytes, 0);
  if (record[site.version]) {
    if (riding) return { running, status: { kind: "available", bytes, held: "riding" }, action: { kind: "none" } };
    return { running, status: { kind: "ready" }, action: { kind: "stage", version: site.version } };
  }
  if (transfer?.state === "downloading") return { running, status: { kind: "downloading", done: transfer.done, total: transfer.total }, action: { kind: "none" } };
  if (riding) return { running, status: { kind: "available", bytes, held: "riding" }, action: { kind: "none" } };
  if (transfer?.state === "failed" && !wanted) return { running, status: { kind: "failed", bytes }, action: { kind: "none" } };
  if (wifi || wanted) return { running, status: { kind: "downloading", done: 0, total: bytes }, action: { kind: "download", version: site.version } };
  return { running, status: { kind: "available", bytes, held: "not-wifi" }, action: { kind: "none" } };
}

/** The files of `site` this phone must download or copy: those whose bytes differ from the APK's own copy. */
export function filesToFetch(site: AppManifest, builtIn: AppManifest | null): AppManifest["files"] {
  const own = new Map((builtIn?.files ?? []).map((f) => [f.path, f.sha256]));
  return site.files.filter((f) => own.get(f.path) !== f.sha256);
}

/** Folders under app/ to keep: the versions in use, staged, kept to fall back to, and the one being downloaded. */
export function keepFolders(info: UpdaterInfo | null, downloading: string | null): Set<string> {
  return new Set([info?.current, info?.next, info?.previous, downloading].filter((v): v is string => !!v));
}
