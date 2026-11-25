/**
 * The Updates panel on Home, Android app only (iteration 7, tasks 34 and 35): when the app last looked at the site,
 * what it found (new routes, route updates, a new version of the app) and a button to look now. It sits at the top
 * of Home while there is something to act on, and above the footer otherwise.
 */
import { useState } from "preact/hooks";
import { appUpdate, packIndex, routeStatus, updateCheck } from "../state";
import type { AppUpdateStatus, PackIndexEntry, RouteStatus } from "../types";
import { routeStore } from "../routes/store";
import { fmtClock, fmtDate, fmtSize } from "./format";

const RELEASES = "https://github.com/evglissin-hue/versta/releases/tag/android-latest";

/** The app update store, loaded on demand so the web build never pulls it in. */
const appStore = (): Promise<typeof import("../update/store")> => import("../update/store");

function names(entries: PackIndexEntry[]): string {
  return entries.map((e) => e.name).join(", ");
}

/** New routes on the site, and routes with a newer copy there. */
export function routeNews(index: PackIndexEntry[], status: Record<string, RouteStatus>): { fresh: PackIndexEntry[]; updated: PackIndexEntry[] } {
  const fresh = index.filter((e) => { const s = status[e.id]; return s?.kind === "on-site" && !s.removed; });
  const updated = index.filter((e) => { const s = status[e.id]; return s?.kind === "on-phone" && !!s.update && !s.update.ready; });
  return { fresh, updated };
}

/** True when the panel has something the rider can act on: it then sits at the top of Home. */
export function updatesNeedYou(): boolean {
  const { fresh } = routeNews(packIndex.value, routeStatus.value);
  const k = appUpdate.value.status.kind;
  return fresh.length > 0 || k === "available" || k === "ready" || k === "failed" || k === "needs-app";
}

function AppLine({ st, riding }: { st: AppUpdateStatus; riding: boolean }) {
  switch (st.kind) {
    case "available":
      return st.held === "not-wifi" ? (
        <div class="acts-col" data-testid="app-update">
          <p class="saved-note">A new version of the app is ready to download, {fmtSize(st.bytes)}.</p>
          <button type="button" class="btn play" onClick={() => void appStore().then((m) => m.appStore.fetch())}>Download the new version</button>
        </div>
      ) : <p class="saved-note" data-testid="app-update">A new version of the app is on its way.</p>;
    case "downloading": {
      const pct = Math.round((st.done / Math.max(1, st.total)) * 100);
      return <div class="acts-col" data-testid="app-update"><p class="saved-note">Downloading a new version of the app, {pct}%.</p><div class="progress"><i style={{ width: `${pct}%` }} /></div></div>;
    }
    case "failed":
      return (
        <p class="saved-note" data-testid="app-update">The app update stopped.{" "}
          <button type="button" class="linkbtn" onClick={() => void appStore().then((m) => m.appStore.fetch())}>Try again</button>
        </p>
      );
    case "ready":
      return (
        <div class="acts-col" data-testid="app-update">
          <p class="saved-note">A new version of the app is ready. It starts next time you open Versta.</p>
          <button type="button" class="btn play" disabled={riding} onClick={() => void appStore().then((m) => m.appStore.restart())}>Restart now</button>
        </div>
      );
    case "needs-app":
      return <p class="saved-note" data-testid="app-update">A new version of the app needs a one-time install. <a class="linkbtn" href={RELEASES} target="_blank" rel="noopener">Get the app</a></p>;
    default:
      return null;
  }
}

export function Updates({ riding = false }: { riding?: boolean }) {
  const c = updateCheck.value;
  const app = appUpdate.value.status;
  const { fresh, updated } = routeNews(packIndex.value, routeStatus.value);
  const news = fresh.length > 0 || updated.length > 0 || app.kind !== "none";
  const line = c.checking ? "Checking for new routes and app updates."
    : c.at === null ? "Not checked yet."
    : c.ok ? (news ? `Checked at ${fmtClock(c.at)}.` : `Up to date. Checked at ${fmtClock(c.at)}.`)
    : `Could not reach the site at ${fmtClock(c.at)}. The routes on this phone still work.`;
  const check = (): void => {
    void routeStore.check(true);
    void appStore().then((m) => m.appStore.check(true)).catch(() => {});
  };
  return (
    <section class="updates" data-testid="updates" aria-label="Updates">
      <span class="label">Updates</span>
      <p class="saved-note" data-testid="updates-line">{line}</p>
      {fresh.length > 0 ? <p class="saved-note">{fresh.length === 1 ? "New route" : "New routes"}: {names(fresh)}. {fresh.length === 1 ? "Its card is" : "Their cards are"} below.</p> : null}
      {updated.length > 0 ? <p class="saved-note">{updated.length === 1 ? "Route update" : "Route updates"}: {names(updated)}.</p> : null}
      <AppLine st={app} riding={riding} />
      <button type="button" class="btn ghost" disabled={c.checking} onClick={check} data-testid="check-updates">{c.checking ? "Checking" : "Check for updates"}</button>
    </section>
  );
}

/**
 * The footer line: which version of the app's code runs, and a way back to the installed one. Going back restarts the
 * app and sets this version aside for good, so it asks first.
 */
export function AppVersionLine() {
  const [asking, setAsking] = useState(false);
  const run = appUpdate.value.running;
  if (!run) return null;
  const when = run.builtAt ? `${fmtDate(Date.parse(run.builtAt))}, ${new Date(run.builtAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : "unknown";
  if (run.source !== "downloaded") return <p data-testid="app-version">App version of {when}, as installed.</p>;
  if (asking) {
    return (
      <div class="acts-col" data-testid="app-version">
        <p>Go back to the version that came with the app? Versta restarts, and this version is not used again.</p>
        <div class="acts">
          <button type="button" class="btn danger small" onClick={() => void appStore().then((m) => m.appStore.useInstalled())}>Go back</button>
          <button type="button" class="btn ghost small" onClick={() => setAsking(false)}>Keep this version</button>
        </div>
      </div>
    );
  }
  return (
    <p data-testid="app-version">App version of {when}, downloaded.{" "}
      <button type="button" class="linkbtn" onClick={() => setAsking(true)}>Use the installed version</button>
    </p>
  );
}
