import { useEffect, useState } from "preact/hooks";
import { deleteRecording, getRecording, listRecordings, saveRecordingFile, type RecordingSummary } from "../record/store";
import { packIndex } from "../state";
import { Sheet } from "./Sheet";
import { recordingsDemo, recordingsOpen } from "./uistate";

function when(ms: number): string {
  const d = new Date(ms);
  return `${d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}, ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
}
function span(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min`;
}

export function Recordings() {
  const [rows, setRows] = useState<RecordingSummary[] | null>(null);
  const [note, setNote] = useState("");
  const demo = recordingsDemo.value;

  const refresh = (): void => { void listRecordings().then(setRows); };
  useEffect(() => { if (demo) setRows(demo); else refresh(); }, []);

  async function save(id: number): Promise<void> {
    setNote("");
    try {
      const r = await getRecording(id);
      if (!r) { setNote("That ride could not be read."); return; }
      await saveRecordingFile(r);
    } catch { setNote("The file could not be saved."); }
  }
  async function remove(id: number): Promise<void> {
    if (demo) { setRows((rows ?? []).filter((r) => r.startedAt !== id)); return; }
    await deleteRecording(id);
    refresh();
  }
  const name = (id: string): string => packIndex.value.find((p) => p.id === id)?.name ?? id;

  return (
    <div class="sc-layer">
      <Sheet title="Ride recordings" onClose={() => { recordingsOpen.value = false; }} testid="recordings">
        <p class="sc-lead">What the phone saw on your last rides. Send one when something went wrong.</p>
        {note ? <p class="sc-note" role="status">{note}</p> : null}
        {rows !== null && rows.length === 0 ? <p class="sc-lead" data-testid="recordings-empty">No rides recorded yet. Your next ride will be.</p> : null}
        {(rows ?? []).map((r) => (
          <div class="recrow" key={r.startedAt} data-testid="recording">
            <span class="swtext"><b>{name(r.packId)}</b><small>{when(r.startedAt)}</small><small>{span(r.durationMs)}, {r.km.toFixed(1)} km</small></span>
            <span class="recacts">
              <button type="button" class="btn small" onClick={() => { void save(r.startedAt); }}>Save file</button>
              <button type="button" class="btn small ghost" onClick={() => { void remove(r.startedAt); }}>Delete</button>
            </span>
          </div>
        ))}
      </Sheet>
    </div>
  );
}
