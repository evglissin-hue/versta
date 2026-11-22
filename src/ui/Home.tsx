import { signal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { offlineStatus, removePackOffline, savePackOffline } from "../offline";
import { isNative } from "../native/platform";
import { forgetSavedRide, loadPack, savedRide, simFromUrl, startRide, type SavedRide } from "../ride";
import { packIndex } from "../state";
import type { PackIndexEntry } from "../types";
import { fmtDate, fmtListening, fmtMB, pad2 } from "./format";
import { Sheet } from "./Sheet";
import { firstRideSheet, netDown, recordingsOpen, soundCheckOpen, startFailure, startPhase } from "./uistate";

/** What the route index may carry beyond the contract: counts and listening time for the line under the blurb. */
type IndexEntry = PackIndexEntry & { stories?: number; asides?: number; minutes?: number };

const RELEASES = "https://github.com/evglissin-hue/versta/releases/tag/android-latest";
const FIRST_KEY = "versta:firstride";
const seenFirstRide = (): boolean => { try { return localStorage.getItem(FIRST_KEY) === "1"; } catch { return true; } };

type Saving =
  | { s: "idle" }
  | { s: "saving"; done: number; total: number }
  | { s: "saved"; bytes: number; savedAt: number | null }
  | { s: "error" };

const saving = signal<Record<string, Saving>>({});
const set = (id: string, v: Saving) => { saving.value = { ...saving.value, [id]: v }; };

/** Name of the last stop reached on a saved ride, per route. Loaded from the route file, which a saved ride has already fetched once. */
const reached = signal<Record<string, string>>({});

async function ride(id: string, resume: SavedRide | null = null): Promise<void> {
  startPhase.value = { id, phase: "loading" }; startFailure.value = null;
  let p;
  try { p = await loadPack(id); } catch { startFailure.value = { id, kind: "load", resume }; startPhase.value = null; return; }
  startPhase.value = { id, phase: "starting" };
  try { await startRide(p, undefined, resume); } catch { startFailure.value = { id, kind: "start", resume }; }
  startPhase.value = null;
}

/** The first ride on a device gets one short sheet before the browser asks for anything. Simulated rides skip it. */
function requestRide(id: string, resume: SavedRide | null = null): void {
  if (!simFromUrl() && !seenFirstRide()) { firstRideSheet.value = { id, resume }; return; }
  void ride(id, resume);
}

function FirstRide() {
  const f = firstRideSheet.value;
  if (!f) return null;
  const go = (): void => {
    try { localStorage.setItem(FIRST_KEY, "1"); } catch {}
    firstRideSheet.value = null;
    void ride(f.id, f.resume);
  };
  return (
    <Sheet bottom modal title="Before you ride" onClose={() => { firstRideSheet.value = null; }} testid="first-ride">
      <p class="note">Versta follows your ride by GPS and talks to you as you go.</p>
      <ul class="tips">
        <li>Allow location when your phone asks.</li>
        <li>Turn the volume up. Earphones are best.</li>
        {isNative()
          ? <><li>Allow location all the time, so the ride carries on in your pocket.</li><li>Allow notifications to see the next turn on the lock screen.</li></>
          : <li>Keep the screen on, or use the Android app for the pocket.</li>}
      </ul>
      <div class="acts"><button type="button" class="btn play" onClick={go}>Start the ride</button></div>
    </Sheet>
  );
}

async function save(entry: PackIndexEntry): Promise<void> {
  set(entry.id, { s: "saving", done: 0, total: 1 });
  try {
    const p = await loadPack(entry.id);
    await savePackOffline(p, (done, total) => set(entry.id, { s: "saving", done, total }));
    const st = await offlineStatus(entry.id);
    set(entry.id, { s: "saved", bytes: st.bytes, savedAt: st.savedAt });
  } catch {
    set(entry.id, { s: "error" });
  }
}

function Continue({ entry, saved, busy, label }: { entry: PackIndexEntry; saved: SavedRide; busy: boolean; label: string }) {
  const last = Math.max(-1, ...saved.arrived);
  useEffect(() => {
    if (reached.value[entry.id] !== undefined) return;
    void loadPack(entry.id).then((p) => { reached.value = { ...reached.value, [entry.id]: p.stops[last] ? `${pad2(last + 1)} ${p.stops[last]!.name}` : "" }; }).catch(() => {});
  }, [entry.id, last]);
  const where = reached.value[entry.id];
  const line = where ? `You reached ${where}` : last >= 0 ? `You reached stop ${pad2(last + 1)} of ${pad2(entry.stops)}` : "You started this ride";
  return (
    <div class="continue" data-testid="continue">
      <button type="button" class="btn play big" disabled={busy} onClick={() => requestRide(entry.id, saved)}>{busy ? label : "Continue ride"}</button>
      <p class="continue-line">{line}</p>
      <button type="button" class="btn ghost small" disabled={busy} onClick={() => { forgetSavedRide(); requestRide(entry.id); }}>Start again</button>
    </div>
  );
}

function Card({ entry }: { entry: IndexEntry }) {
  const st = saving.value[entry.id] ?? { s: "idle" };
  useEffect(() => {
    void offlineStatus(entry.id).then((o) => { if (o.saved) set(entry.id, { s: "saved", bytes: o.bytes, savedAt: o.savedAt }); });
  }, [entry.id]);
  const base = import.meta.env.BASE_URL;
  const phase = startPhase.value?.id === entry.id ? startPhase.value.phase : null;
  const busy = startPhase.value !== null;
  const label = phase === "loading" ? "Loading the route" : "Starting the ride";
  const failure = startFailure.value?.id === entry.id ? startFailure.value : null;
  const offlineUnsaved = netDown.value && st.s !== "saved" && st.s !== "saving";
  const inside = [
    `${entry.stops} stops`,
    entry.stories ? `${entry.stories} stories` : null,
    entry.asides ? `${entry.asides} passing-by stories` : null,
    entry.minutes ? fmtListening(entry.minutes) : null,
  ].filter((x): x is string => x !== null);
  const saved = savedRide();
  const resume = saved && saved.packId === entry.id ? saved : null;
  return (
    <article class="card" data-testid="route-card">
      <div class="card-pic">
        <img src={`${base}${entry.hero}`} alt="" loading="eager" />
        <div class="card-words">
          <span class="label">{entry.mode === "bicycling" ? "Bike ride" : "Walk"}</span>
          <h2>{entry.name}</h2>
        </div>
      </div>
      <div class="stats">
        <div><b>{entry.km}</b><span>km</span></div>
        <div><b>{entry.stops}</b><span>stops</span></div>
      </div>
      <p class="blurb">{entry.blurb}</p>
      {inside.length > 1 ? <p class="inside" data-testid="inside">{inside.map((x, i) => <span key={x}><span class="nb">{x}{i < inside.length - 1 ? "," : ""}</span>{" "}</span>)}</p> : null}
      {resume ? <Continue entry={entry} saved={resume} busy={busy} label={label} /> : null}
      <div class="acts">
        {resume ? null : <button type="button" class={`btn play ${phase ? "busy" : ""}`} disabled={busy} onClick={() => requestRide(entry.id)}>{phase ? label : "Ride"}</button>}
        <button type="button" class="btn ghost" disabled={st.s === "saving" || st.s === "saved"} onClick={() => void save(entry)}>
          {st.s === "saving" ? `Saving ${Math.round((st.done / st.total) * 100)}%` : st.s === "saved" ? "Saved for offline" : st.s === "error" ? "Try saving again" : "Save for offline"}
        </button>
      </div>
      {failure ? (
        <div class="failure" role="alert" data-testid="load-failure">
          <p class="warn-note">{failure.kind === "load" ? "Could not load the route. Check your connection and try again." : "Could not start the ride. Try again."}</p>
          <button type="button" class="btn" disabled={busy} onClick={() => void ride(failure.id, failure.resume)}>Try again</button>
        </div>
      ) : null}
      {offlineUnsaved && !failure ? <p class="warn-note" data-testid="offline-note">You are offline and this route is not saved on this device. Connect to ride it.</p> : null}
      {st.s === "saving" ? <div class="progress"><i style={{ width: `${(st.done / st.total) * 100}%` }} /></div> : null}
      {st.s === "error" ? <p class="warn-note">Some files did not save. Check your connection and try again.</p> : null}
      {st.s === "saved" ? (
        <p class="saved-note">
          {st.savedAt ? `Saved ${fmtDate(st.savedAt)}, ` : "Saved, "}{fmtMB(st.bytes)}. Works without signal.{" "}
          <button type="button" class="linkbtn" onClick={() => void removePackOffline(entry.id).then(() => set(entry.id, { s: "idle" }))}>Remove</button>
        </p>
      ) : null}
    </article>
  );
}

export function Home() {
  useEffect(() => {
    const up = (): void => { netDown.value = false; };
    const down = (): void => { netDown.value = true; };
    window.addEventListener("online", up); window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);
  const simOn = new URLSearchParams(location.search).get("sim") === "1";
  return (
    <main class="home">
      <header class="home-top">
        <h1>Versta</h1>
        <p>Rides and walks that tell you their stories as you pass.</p>
      </header>
      {packIndex.value.map((e) => <Card key={e.id} entry={e} />)}
      <footer class="foot">
        <p>Pictures are public domain works from Wikimedia Commons. Map data &copy; OpenStreetMap contributors. Map tiles by OpenFreeMap. Your progress stays on this device.</p>
        {isNative() ? null : <p><a class="linkbtn" href={RELEASES} target="_blank" rel="noopener" data-testid="android-link">Android app</a> keeps guiding with the screen off.</p>}
        <p><button type="button" class="linkbtn" onClick={() => { soundCheckOpen.value = true; }}>Sound check</button> lets you hear every sound before you ride.</p>
        <p><button type="button" class="linkbtn" onClick={() => { recordingsOpen.value = true; }}>Ride recordings</button> is what the phone saw on your last rides.</p>
        {simOn
          ? <p>Simulation is on: Ride starts a pretend ride. <a class="linkbtn" href={import.meta.env.BASE_URL}>Use real GPS</a></p>
          : <a class="linkbtn" href={`${import.meta.env.BASE_URL}?sim=1&speed=5&scale=8`}>Simulate a ride</a>}
      </footer>
      <FirstRide />
    </main>
  );
}
