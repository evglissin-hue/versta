/**
 * The route store's decisions, pure: what each route is on this phone, what the home list shows and what to do next.
 * No browser, no Capacitor, no clock. `store.ts` feeds it and runs what it answers.
 */
import type { PackIndexEntry, RouteStatus, RouteUpdate, Transfer } from "../types";

/** A copy kept on the phone (`versta:routes`). */
export interface DownloadedCopy { version: string; updated: string; entry: PackIndexEntry }

/** A newer version fully downloaded and verified, waiting to be switched in (`versta:routes-next`). */
export interface StagedCopy extends DownloadedCopy {
  /** What the update cost to download. */
  bytes: number;
  /** The stop ids, in order, differ from the copy it replaces. */
  stopsChanged: boolean;
}

export interface PlanInput {
  /** The routes built into the APK (its own index). */
  builtIn: PackIndexEntry[];
  /** Downloaded copies in use. */
  record: Record<string, DownloadedCopy>;
  /** Updates downloaded and waiting. */
  staged: Record<string, StagedCopy>;
  /** The site's index, or null when it could not be read. */
  site: PackIndexEntry[] | null;
  /** The route being ridden now ("" when a ride runs and its route is not known), or null with no ride running. */
  riding: string | null;
  /** The route of the saved (unfinished) ride, or null. */
  savedRideId: string | null;
  /** On Wi-Fi or ethernet, and data saver is off. */
  wifi: boolean;
  /** Routes the rider removed. */
  removed: string[];
  /** Downloads in progress or stopped this session. */
  transfers: Record<string, Transfer>;
  /** Routes the rider asked for with a tap this session: they ignore Wi-Fi, "removed" and an earlier failure. */
  wanted: string[];
  /** What an update will cost, once its manifest has been read. */
  costs: Record<string, { version: string; bytes: number }>;
  /** The newest pack format this app reads. */
  appFormat: number;
}

export type PlanAction =
  /** A downloaded copy that is not newer than the built-in one: forget it and delete its folder. */
  | { kind: "drop"; id: string }
  /** A staged update that is no longer wanted (the site moved on, or it is not newer): delete its folder. */
  | { kind: "drop-next"; id: string }
  /** Make the staged update the copy in use. */
  | { kind: "switch"; id: string }
  /** Download the site's version of this route (to staging). */
  | { kind: "download"; id: string }
  | { kind: "none" };

export interface Plan {
  status: Record<string, RouteStatus>;
  /** For `packIndex`: the site's order first, then routes only on the phone. */
  index: PackIndexEntry[];
  action: PlanAction;
}

const stamp = (s: string | undefined): number => { const t = s ? Date.parse(s) : NaN; return Number.isFinite(t) ? t : 0; };

/** Which copy is in use: the built-in one, or the downloaded one when it is strictly newer. */
export function chooseCopy(builtIn: PackIndexEntry | undefined, down: DownloadedCopy | undefined):
  { source: "built-in" | "downloaded"; entry: PackIndexEntry; version: string; updated: string } | { source: "drop" } | null {
  if (builtIn && down) {
    if (stamp(down.updated) > stamp(builtIn.updated)) return { source: "downloaded", entry: down.entry, version: down.version, updated: down.updated };
    return { source: "drop" };
  }
  if (down) return { source: "downloaded", entry: down.entry, version: down.version, updated: down.updated };
  if (builtIn) return { source: "built-in", entry: builtIn, version: builtIn.version ?? "", updated: builtIn.updated ?? "" };
  return null;
}

export function plan(input: PlanInput): Plan {
  const { builtIn, record, staged, site, riding, savedRideId, wifi, transfers, wanted, costs, appFormat } = input;
  const removed = new Set(input.removed);
  const builtById = new Map(builtIn.map((e) => [e.id, e]));
  const siteById = new Map((site ?? []).map((e) => [e.id, e]));
  const ids: string[] = [];
  for (const e of site ?? []) if (!ids.includes(e.id)) ids.push(e.id);
  for (const e of builtIn) if (!ids.includes(e.id)) ids.push(e.id);
  for (const id of Object.keys(record)) if (!ids.includes(id)) ids.push(id);

  const status: Record<string, RouteStatus> = {};
  const index: PackIndexEntry[] = [];
  const drops: PlanAction[] = [];
  const dropNext: PlanAction[] = [];
  const switches: PlanAction[] = [];
  const downloads: PlanAction[] = [];

  for (const id of ids) {
    const s = siteById.get(id);
    const chosen = chooseCopy(builtById.get(id), record[id]);
    const tapped = wanted.includes(id);
    const tr = transfers[id] ?? null;
    const canStart = riding === null && (tapped || (wifi && !removed.has(id) && tr?.state !== "failed"));

    if (chosen?.source === "drop") drops.push({ kind: "drop", id });
    // A dropped downloaded copy is as good as gone: the built-in one is what the phone has.
    const local = chosen === null ? null : chosen.source === "drop"
      ? { source: "built-in" as const, entry: builtById.get(id)!, version: builtById.get(id)!.version ?? "", updated: builtById.get(id)!.updated ?? "" }
      : chosen;

    if (!local) {
      // Only on the site.
      if (!s) continue;
      index.push(s);
      if ((s.format ?? 1) > appFormat) { status[id] = { kind: "needs-app" }; continue; }
      status[id] = { kind: "on-site", bytes: s.bytes ?? 0, transfer: tr, removed: removed.has(id) };
      const st = staged[id];
      if (st && st.version === s.version) switches.push({ kind: "switch", id });
      else if (st) dropNext.push({ kind: "drop-next", id });
      else if (canStart) downloads.push({ kind: "download", id });
      continue;
    }

    index.push(local.entry);
    const st = staged[id];
    const newer = !!s && !!s.version && s.version !== local.version && stamp(s.updated) > stamp(local.updated);
    // A staged copy stays while the site still offers it, or while the site cannot be read.
    const stagedValid = !!st && stamp(st.updated) > stamp(local.updated) && (site === null || s?.version === st.version);
    if (st && !stagedValid) dropNext.push({ kind: "drop-next", id });

    let update: RouteUpdate | null = null;
    if (stagedValid && st) {
      let held: "riding" | "saved-ride" | null = null;
      if (riding === id) held = "riding";
      else if (savedRideId === id && st.stopsChanged) held = "saved-ride";
      update = { bytes: st.bytes, transfer: null, held, ready: true };
      if (!held) switches.push({ kind: "switch", id });
    } else if (newer && s) {
      const cost = costs[id]?.version === s.version ? costs[id]!.bytes : (s.bytes ?? 0);
      if ((s.format ?? 1) > appFormat) {
        update = { bytes: cost, transfer: null, held: "needs-app", ready: false };
      } else {
        const working = tr?.state === "downloading";
        const held = !canStart && !working && riding === null ? "not-wifi" : null;
        update = { bytes: cost, transfer: tr, held, ready: false };
        if (canStart) downloads.push({ kind: "download", id });
      }
    }
    status[id] = { kind: "on-phone", source: local.source, version: local.version, bytes: local.entry.bytes ?? 0, update };
  }

  const action = drops[0] ?? dropNext[0] ?? switches[0] ?? downloads[0] ?? { kind: "none" as const };
  return { status, index, action };
}
