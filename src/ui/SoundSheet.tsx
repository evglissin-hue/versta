import { settings, updateSettings } from "../state";
import type { Settings } from "../types";
import { Sheet } from "./Sheet";
import { soundCheckOpen, soundOpen } from "./uistate";

type Flag = "storyVoice" | "navVoice" | "ambience" | "music" | "autoPlayStories" | "keepAwake" | "courseUp" | "autoRecentre" | "haptics";
interface FlagRow { key: Flag; label: string; hint: string }

const VOICES: FlagRow[] = [
  { key: "storyVoice", label: "Story voice", hint: "Reads each story aloud. Off: you tap to read it." },
  { key: "navVoice", label: "Turn instructions", hint: "Says each turn aloud before you reach it." },
];
const ATMOSPHERE: FlagRow[] = [
  { key: "ambience", label: "Soundscape", hint: "Quiet sounds of the place under a story." },
  { key: "music", label: "Music", hint: "A soft tune under a story." },
];
const RIDING: FlagRow[] = [
  { key: "autoPlayStories", label: "Start stories on arrival", hint: "Plays a stop's main stories when you get there." },
  { key: "keepAwake", label: "Keep the screen awake", hint: "Stops the phone locking during the ride." },
  { key: "courseUp", label: "Course up", hint: "The map turns so your direction of travel points up. Off: north stays up." },
  { key: "autoRecentre", label: "Recentre by itself", hint: "Brings the map back to you a few seconds after you let go of it." },
  { key: "haptics", label: "Vibrate at turns", hint: "A short buzz at turns and stops." },
];

interface Choice<T extends string> { key: T; label: string; hint: string }
const LEVELS: Choice<Settings["bedLevel"]>[] = [
  { key: "soft", label: "Soft", hint: "Barely there. The voice is all you hear." },
  { key: "balanced", label: "Balanced", hint: "Sits under the voice without competing." },
  { key: "rich", label: "Rich", hint: "Full and present. Best with earphones." },
];
const ASIDES: Choice<Settings["asides"]>[] = [
  { key: "off", label: "Off", hint: "No passing-by stories. Only turns and stops." },
  { key: "sparse", label: "Sparse", hint: "A short story now and then." },
  { key: "rich", label: "Rich", hint: "A short story at most places worth one." },
];

function Switches({ rows }: { rows: FlagRow[] }) {
  const s = settings.value;
  return (
    <div class="switchlist">
      {rows.map((f) => (
        <button type="button" role="switch" aria-checked={s[f.key]} class="switchrow" key={f.key} onClick={() => updateSettings({ [f.key]: !s[f.key] })}>
          <span class="swtext"><b>{f.label}</b><small>{f.hint}</small></span>
          <span class="swstate">{s[f.key] ? "On" : "Off"}</span>
        </button>
      ))}
    </div>
  );
}

/** Three choices side by side, with one line under them that explains the one chosen. */
function Pick<T extends string>({ title, choices, value, onPick, testid }: { title: string; choices: Choice<T>[]; value: T; onPick: (k: T) => void; testid: string }) {
  const now = choices.find((c) => c.key === value);
  return (
    <div class="pick" data-testid={testid}>
      <b class="pick-title">{title}</b>
      <div class="segs" role="radiogroup" aria-label={title}>
        {choices.map((c) => (
          <button type="button" role="radio" aria-checked={value === c.key} class="seg" key={c.key} onClick={() => onPick(c.key)}>{c.label}</button>
        ))}
      </div>
      <small>{now?.hint}</small>
    </div>
  );
}

export function SoundSheet() {
  const s = settings.value;
  const canBuzz = typeof navigator !== "undefined" && "vibrate" in navigator;
  return (
    <Sheet title="Sound and settings" onClose={() => { soundOpen.value = false; }} testid="sound-sheet">
      <div class="label">Voices</div>
      <Switches rows={VOICES} />
      <div class="label">Atmosphere</div>
      <Switches rows={ATMOSPHERE} />
      <Pick title="Soundscape level" choices={LEVELS} value={s.bedLevel} onPick={(k) => updateSettings({ bedLevel: k })} testid="bed-level" />
      <div class="label">Riding</div>
      <Pick title="Passing-by stories" choices={ASIDES} value={s.asides} onPick={(k) => updateSettings({ asides: k })} testid="asides-pick" />
      <Switches rows={canBuzz ? RIDING : RIDING.filter((r) => r.key !== "haptics")} />
      <div class="label">Sounds</div>
      <button type="button" class="btn" onClick={() => { soundCheckOpen.value = true; }}>Sound check</button>
    </Sheet>
  );
}
