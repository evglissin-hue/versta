import { settings, updateSettings } from "../state";
import type { Settings } from "../types";
import { Sheet } from "./Sheet";
import { soundOpen } from "./uistate";

type Flag = "storyVoice" | "navVoice" | "ambience" | "music" | "autoPlayStories" | "keepAwake" | "courseUp";
const FLAGS: { key: Flag; label: string; hint: string }[] = [
  { key: "storyVoice", label: "Story voice", hint: "Reads each story aloud. Off: you tap to read it." },
  { key: "navVoice", label: "Turn voice", hint: "Says each turn aloud before you reach it." },
  { key: "ambience", label: "Ambience", hint: "Quiet sounds of the place under a story." },
  { key: "music", label: "Music", hint: "A soft tune under a story." },
  { key: "autoPlayStories", label: "Play stories at stops", hint: "Starts a stop's main stories when you arrive." },
  { key: "keepAwake", label: "Keep screen on", hint: "Stops the phone locking during the ride." },
  { key: "courseUp", label: "Map turns with you", hint: "Your direction of travel points up." },
];
const ASIDES: { key: Settings["asides"]; label: string; hint: string }[] = [
  { key: "off", label: "Off", hint: "No passing-by stories. Only turns and stops." },
  { key: "sparse", label: "Sparse", hint: "A short story now and then." },
  { key: "rich", label: "Rich", hint: "A short story at most places worth one." },
];

export function SoundSheet() {
  const s = settings.value;
  return (
    <Sheet title="Sound and settings" onClose={() => { soundOpen.value = false; }} testid="sound-sheet">
      <div class="switchlist">
        {FLAGS.map((f) => (
          <button type="button" role="switch" aria-checked={s[f.key]} class="switchrow" key={f.key} onClick={() => updateSettings({ [f.key]: !s[f.key] })}>
            <span class="swtext"><b>{f.label}</b><small>{f.hint}</small></span>
            <span class="swstate">{s[f.key] ? "On" : "Off"}</span>
          </button>
        ))}
      </div>
      <div class="label">Passing-by stories</div>
      <div class="switchlist" role="radiogroup" aria-label="Passing-by stories">
        {ASIDES.map((a) => (
          <button type="button" role="radio" aria-checked={s.asides === a.key} class="switchrow" key={a.key} onClick={() => updateSettings({ asides: a.key })}>
            <span class="swtext"><b>{a.label}</b><small>{a.hint}</small></span>
            <span class="swstate">{s.asides === a.key ? "Chosen" : ""}</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}
