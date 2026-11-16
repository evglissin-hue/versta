import { signal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { offlineStatus, removePackOffline, savePackOffline } from "../offline";
import { loadPack, startRide } from "../ride";
import { packIndex } from "../state";
import type { PackIndexEntry } from "../types";
import { fmtDate, fmtMB } from "./format";

type Saving =
  | { s: "idle" }
  | { s: "saving"; done: number; total: number }
  | { s: "saved"; bytes: number; savedAt: number | null }
  | { s: "error" };

const saving = signal<Record<string, Saving>>({});
const starting = signal<string | null>(null);
const startError = signal<string | null>(null);
const set = (id: string, v: Saving) => { saving.value = { ...saving.value, [id]: v }; };

async function ride(id: string): Promise<void> {
  starting.value = id; startError.value = null;
  try {
    const p = await loadPack(id);
    await startRide(p);
  } catch {
    startError.value = "Could not start the ride. Check your connection, or save the route for offline first.";
  } finally { starting.value = null; }
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

function Card({ entry }: { entry: PackIndexEntry }) {
  const st = saving.value[entry.id] ?? { s: "idle" };
  useEffect(() => {
    void offlineStatus(entry.id).then((o) => { if (o.saved) set(entry.id, { s: "saved", bytes: o.bytes, savedAt: o.savedAt }); });
  }, [entry.id]);
  const base = import.meta.env.BASE_URL;
  const busy = starting.value === entry.id;
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
      <div class="acts">
        <button type="button" class="btn play" disabled={busy} onClick={() => void ride(entry.id)}>{busy ? "Starting" : "Ride"}</button>
        <button type="button" class="btn ghost" disabled={st.s === "saving" || st.s === "saved"} onClick={() => void save(entry)}>
          {st.s === "saving" ? `Saving ${Math.round((st.done / st.total) * 100)}%` : st.s === "saved" ? "Saved for offline" : st.s === "error" ? "Try saving again" : "Save for offline"}
        </button>
      </div>
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
  const simOn = new URLSearchParams(location.search).get("sim") === "1";
  return (
    <main class="home">
      <header class="home-top">
        <h1>Versta</h1>
        <p>Rides and walks that tell you their stories as you pass.</p>
      </header>
      {packIndex.value.map((e) => <Card key={e.id} entry={e} />)}
      {startError.value ? <p class="warn-note" role="alert">{startError.value}</p> : null}
      <footer class="foot">
        <p>Pictures are public domain works from Wikimedia Commons. Map data &copy; OpenStreetMap contributors. Map tiles by OpenFreeMap. Your progress stays on this device.</p>
        {simOn
          ? <p>Simulation is on: Ride starts a pretend ride. <a class="linkbtn" href={import.meta.env.BASE_URL}>Use real GPS</a></p>
          : <a class="linkbtn" href={`${import.meta.env.BASE_URL}?sim=1&speed=5&scale=8`}>Simulate a ride</a>}
      </footer>
    </main>
  );
}
