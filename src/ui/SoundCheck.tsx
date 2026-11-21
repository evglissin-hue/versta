import { useEffect, useRef, useState } from "preact/hooks";
import catalogue from "../audio/catalogue.json";
import { createMixer } from "../audio/mixer";
import { currentDirector, currentMixer } from "../ride";
import { nowPlaying, packBase, packIndex } from "../state";
import type { Mixer, SignalName } from "../types";
import { Sheet } from "./Sheet";
import { soundCheckOpen } from "./uistate";

interface Credit { file: string; title: string; author: string; licence: string; source: string }
type Entry = { label: string; seconds?: number };
type Section = Record<string, Entry>;

const SIGNALS = catalogue.signals as Section;
const MUSIC = catalogue.music as Section;
const EFFECTS = catalogue.effects as Section;
const SOUNDSCAPES = catalogue.soundscapes as Section;

/** Credits files are optional while the sound library is being filled: whatever exists is shown. */
const creditFiles = import.meta.glob("../audio/credits-*.json", { eager: true, import: "default" }) as Record<string, Credit[]>;
const creditGroups = (["sounds", "music"] as const)
  .map((g) => ({ group: g, list: creditFiles[`../audio/credits-${g}.json`] ?? [] }))
  .filter((g) => Array.isArray(g.list) && g.list.length > 0);

const NARRATOR_PACK = "thames-loop";
const NARRATOR_STORY = "tower-bridge-0";

interface Clip { src: string; breaks?: number[]; dur: number }
let clipPromise: Promise<Clip | null> | null = null;
/** The story clip the narrator switch plays, from the Thames pack. Null when it cannot be fetched. */
function loadClip(): Promise<Clip | null> {
  clipPromise ??= fetch(`${packBase(NARRATOR_PACK)}pack.json`)
    .then((r) => r.json() as Promise<{ stops: { stories: { id: string; audio?: { src: string; breaks?: number[]; dur: number } }[] }[] }>)
    .then((p) => {
      const a = p.stops.flatMap((s) => s.stories).find((s) => s.id === NARRATOR_STORY)?.audio;
      return a ? { src: `${packBase(NARRATOR_PACK)}${a.src}`, breaks: a.breaks, dur: a.dur } : null;
    })
    .catch(() => null);
  return clipPromise;
}

function Row({ name, entry, busy, label, onPress }: { name: string; entry: Entry; busy: boolean; label: string; onPress: () => void }) {
  return (
    <div class="scrow" data-testid="sc-row">
      <span class="swtext"><b>{entry.label}</b><small>{name}</small></span>
      <button type="button" class={`btn small ${busy ? "ghost" : "play"} scbtn`} aria-label={`${label} ${entry.label}`} onClick={onPress}>{label}</button>
    </div>
  );
}

export function SoundCheck() {
  const mixer = useRef<Mixer | null>(null);
  const alive = useRef(true);
  const loopOn = useRef(false);
  const [ambience, setAmbience] = useState<string | null>(null);
  const [music, setMusic] = useState<string | null>(null);
  const [signalNow, setSignalNow] = useState<string | null>(null);
  const [effects, setEffects] = useState<string[]>([]);
  const [narrator, setNarrator] = useState(false);
  const [note, setNote] = useState("");
  const bed = useRef<{ a: string | null; m: string | null }>({ a: null, m: null });

  useEffect(() => {
    alive.current = true;
    // A ride may be running underneath: pause its story and let its bed go quiet. The rider taps Resume afterwards.
    const np = nowPlaying.value;
    if (np?.kind === "story" && !np.paused) currentDirector()?.togglePause();
    currentMixer()?.stopBed(0.5);
    return () => { alive.current = false; loopOn.current = false; mixer.current?.dispose?.(); mixer.current = null; };
  }, []);

  /** The sound check's own mixer, made on the first tap so the browser lets it play. */
  async function ensure(): Promise<Mixer> {
    if (mixer.current) return mixer.current;
    const m = createMixer({ baseUrl: packBase(packIndex.value[0]?.id ?? NARRATOR_PACK), virtual: false });
    mixer.current = m;
    try { await m.unlock(); } catch { /* a blocked context stays silent; nothing to show */ }
    return m;
  }

  async function setBed(a: string | null, m: string | null): Promise<void> {
    const mx = await ensure();
    bed.current = { a, m };
    setAmbience(a); setMusic(m);
    if (a === null && m === null) mx.stopBed(0.5); else mx.startBed(a, m);
  }

  async function playSignal(name: string): Promise<void> {
    const mx = await ensure();
    setSignalNow(name);
    try { await mx.signal(name as SignalName); } catch { /* ignored */ }
    if (alive.current) setSignalNow((n) => (n === name ? null : n));
  }

  async function playEffect(name: string): Promise<void> {
    const mx = await ensure();
    mx.playEffect(name);
    setEffects((e) => [...e, name]);
    window.setTimeout(() => { if (alive.current) setEffects((e) => { const i = e.indexOf(name); return i < 0 ? e : [...e.slice(0, i), ...e.slice(i + 1)]; }); }, (EFFECTS[name]?.seconds ?? 4) * 1000);
  }

  async function startNarrator(): Promise<void> {
    const mx = await ensure();
    const clip = await loadClip();
    if (!clip) { setNote("The story could not be loaded."); setNarrator(false); return; }
    loopOn.current = true;
    setNarrator(true);
    const again = (): void => {
      if (!loopOn.current || !alive.current) return;
      mx.playVoice(clip.src, { estimatedSeconds: clip.dur, breaks: clip.breaks }).done.then(again, () => { /* stopped */ });
    };
    again();
  }
  function stopNarrator(): void {
    loopOn.current = false;
    setNarrator(false);
    mixer.current?.stopVoice(0.4);
  }
  function toggleNarrator(): void {
    setNote("");
    if (narrator) stopNarrator(); else void startNarrator();
  }

  function stopAll(): void {
    stopNarrator();
    bed.current = { a: null, m: null };
    setAmbience(null); setMusic(null); setEffects([]);
    mixer.current?.stopBed(0.5);
  }

  const anything = ambience !== null || music !== null || signalNow !== null || effects.length > 0 || narrator;
  const close = (): void => { soundCheckOpen.value = false; };

  return (
    <div class="sc-layer">
      <Sheet title="Sound check" onClose={close} testid="sound-check">
        <p class="sc-lead">Hear every sound before you ride. Plays through this device only.</p>
        <div class="switchlist">
          <button type="button" role="switch" aria-checked={narrator} class="switchrow" onClick={toggleNarrator}>
            <span class="swtext"><b>With the narrator</b><small>Plays a story over the sound, as on a ride.</small></span>
            <span class="swstate">{narrator ? "On" : "Off"}</span>
          </button>
        </div>
        {note ? <p class="sc-note" role="status">{note}</p> : null}
        {anything ? <button type="button" class="btn danger" onClick={stopAll}>Stop all</button> : null}

        <div class="label">Soundscapes</div>
        <div class="switchlist" data-testid="sc-soundscapes">
          {Object.entries(SOUNDSCAPES).map(([name, e]) => {
            const on = ambience === name;
            return <Row key={name} name={name} entry={e} busy={on} label={on ? "Stop" : "Play"} onPress={() => void setBed(on ? null : name, bed.current.m)} />;
          })}
        </div>

        <div class="label">Music</div>
        <div class="switchlist" data-testid="sc-music">
          {Object.entries(MUSIC).map(([name, e]) => {
            const on = music === name;
            return <Row key={name} name={name} entry={e} busy={on} label={on ? "Stop" : "Play"} onPress={() => void setBed(bed.current.a, on ? null : name)} />;
          })}
        </div>

        <div class="label">Signals</div>
        <div class="switchlist" data-testid="sc-signals">
          {Object.entries(SIGNALS).map(([name, e]) => {
            const on = signalNow === name;
            return <Row key={name} name={name} entry={e} busy={on} label={on ? "Playing" : "Play"} onPress={() => { if (!on) void playSignal(name); }} />;
          })}
        </div>

        <div class="label">Effects</div>
        <div class="switchlist" data-testid="sc-effects">
          {Object.entries(EFFECTS).map(([name, e]) => {
            const on = effects.includes(name);
            return <Row key={name} name={name} entry={e} busy={on} label={on ? "Playing" : "Play"} onPress={() => { if (!on) void playEffect(name); }} />;
          })}
        </div>

        <div class="label">Sound credits</div>
        <div class="sc-credits" data-testid="sc-credits">
          {creditGroups.length === 0 ? <p>Credits appear here as sounds are added.</p> : null}
          {creditGroups.map(({ group, list }) => (
            <section key={group}>
              <b>{group === "music" ? "Music" : "Sounds"}</b>
              <ul>
                {list.map((c) => (
                  <li key={c.file}>
                    {c.title}, {c.author}, {c.licence}. <a class="linkbtn" href={c.source} target="_blank" rel="noopener">Source</a>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </Sheet>
    </div>
  );
}
