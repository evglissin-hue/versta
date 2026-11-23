import { signal } from "@preact/signals";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "../map/map.css";
import { createMixer } from "../audio/mixer";
import { DARK, EMPTY, LIGHT, TILEJSON_URL, buildStyle, type Palette } from "../map/style";
import { tileTemplate } from "../offline";
import { isNative } from "../native/platform";
import { createGpsSource } from "../nav/sources";
import { loadPlaces } from "../places/library";
import { createArrivalWatcher, nearbyPlaces, paraAt } from "../places/nearby";
import { REFUSED_NOTE, placeWatchOn, startPlaceWatch, stopPlaceWatch } from "../places/watch";
import { packBase, packIndex, routeStatus } from "../state";
import type { LngLat, Mixer, Pack, Place, PlacesFile } from "../types";
import { fmtDist } from "./format";
import { nearbyOpen } from "./uistate";

/** Preview only: a made-up position instead of GPS, and whether a story is already playing (silently). */
export const nearbyDemo = signal<{ at: LngLat; playing: boolean } | null>(null);

const RANGE = 3000;
/** Markers on the map: the nearest few only, so they do not pile up; the list below still holds every place in range. */
const MAP_MARKERS = 12;

/** A story is playing on the Nearby screen (Back stops it before it closes the screen). */
export const nearbyPlaying = signal(false);
/** Play a place's first story, or stop the one playing, from outside the screen (Back, a notification tap). */
export const nearbyControls: { play: ((placeId: string) => boolean) | null; stop: (() => void) | null } = { play: null, stop: null };

interface StoryText { paras: string[]; marks?: number[]; breaks?: number[] }
interface Playing { place: Place; storyId: string; title: string; pic: string | null; caption: string | null; text: StoryText; para: number; paused: boolean; dur: number }

const packCache = new Map<string, Promise<Pack | null>>();
function loadPackJson(id: string): Promise<Pack | null> {
  let p = packCache.get(id);
  if (!p) {
    p = fetch(`${packBase(id)}pack.json`).then((r) => (r.ok ? (r.json() as Promise<Pack>) : null)).catch(() => null);
    packCache.set(id, p);
    void p.then((v) => { if (!v) packCache.delete(id); });
  }
  return p;
}

/** The text of a place's story, from its route file. Empty text when the file cannot be read. */
async function storyText(place: Place, storyId: string): Promise<{ text: StoryText; caption: string | null }> {
  const pack = await loadPackJson(place.pack);
  if (!pack) return { text: { paras: [] }, caption: null };
  const own = place.id.slice(place.pack.length + 1);
  const stop = pack.stops.find((s) => s.id === own) ?? pack.stops.find((s) => s.stories.some((x) => x.id === storyId));
  const story = stop?.stories.find((x) => x.id === storyId);
  if (story) return { text: { paras: story.paras, marks: story.audio?.marks, breaks: story.audio?.breaks }, caption: story.pic?.caption ?? null };
  const aside = pack.asides.find((a) => a.id === storyId || a.id === own);
  if (aside) return { text: { paras: [aside.text], breaks: aside.breaks }, caption: null };
  return { text: { paras: [] }, caption: null };
}

const absolute = (path: string): string => new URL(path, document.baseURI).href;

type Where = "waiting" | "found" | "denied";

export function Nearby() {
  const demo = nearbyDemo.value;
  const native = isNative();
  const [file, setFile] = useState<PlacesFile | null>(null);
  const [failed, setFailed] = useState(false);
  const [here, setHere] = useState<LngLat | null>(demo?.at ?? null);
  const [where, setWhere] = useState<Where>(demo ? "found" : "waiting");
  const [selected, setSelected] = useState<string | null>(null);
  const [playing, setPlaying] = useState<Playing | null>(null);
  const [auto, setAuto] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [pocketNote, setPocketNote] = useState("");
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const mixer = useRef<Mixer | null>(null);
  const token = useRef(0);
  const alive = useRef(true);
  const watcher = useRef(createArrivalWatcher());
  const autoRef = useRef(false);
  const playingRef = useRef<Playing | null>(null);
  const pending = useRef<Place[]>([]);
  const markers = useRef<Map<string, { marker: maplibregl.Marker; el: HTMLButtonElement }>>(new Map());
  const riderMarker = useRef<maplibregl.Marker | null>(null);
  const fitted = useRef("");
  const playRef = useRef<(p: Place) => void>(() => {});
  playingRef.current = playing;
  autoRef.current = auto;

  const playable = (place: Place): "yes" | "download" | "downloading" | "needs-app" => {
    if (!isNative()) return "yes";
    const st = routeStatus.value[place.pack];
    if (st?.kind === "on-phone") return "yes";
    if (st?.kind === "needs-app") return "needs-app";
    if (st?.kind === "on-site" && st.transfer?.state === "downloading") return "downloading";
    return "download";
  };

  const places = useMemo(() => (file?.places ?? []).filter((p) => p.stories.length > 0), [file]);
  const origin: LngLat | null = here ?? (where === "denied" ? places[0]?.at ?? null : null);
  const list = useMemo(() => (origin ? nearbyPlaces(places, origin, here ? RANGE : Infinity) : []), [places, origin, here]);
  const listKey = list.map((l) => l.place.id).join(",");

  /* ---- places ---- */
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    loadPlaces().then((f) => { if (!cancelled) setFile(f); }, () => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; alive.current = false; };
  }, []);

  /* ---- position ---- */
  useEffect(() => {
    if (demo) return;
    const gps = createGpsSource();
    gps.start(
      (fix) => { setHere([fix.lng, fix.lat]); setWhere("found"); },
      () => { setWhere((w) => (w === "found" ? w : "denied")); },
    );
    return () => gps.stop();
  }, []);

  /* ---- arrivals ---- */
  useEffect(() => {
    if (!here || !auto) return;
    for (const p of watcher.current.check(here, places)) pending.current.push(p);
    if (!playingRef.current) { const next = pending.current.shift(); if (next) playRef.current(next); }
  }, [here, auto, places]);

  /* ---- the map ---- */
  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let disposed = false;
    const dark = window.matchMedia("(prefers-color-scheme: dark)");
    const palette = (): Palette => (dark.matches ? DARK : LIGHT);
    let tilesNow: { url?: string; tiles?: string[] } = { url: TILEJSON_URL };
    const data = { lines: EMPTY, asides: EMPTY, cue: EMPTY, guide: EMPTY, detour: EMPTY, rejoin: EMPTY };
    let map: maplibregl.Map | null = null;
    const restyle = (): void => { map?.setStyle(buildStyle(palette(), tilesNow, data)); };
    void (async () => {
      try { tilesNow = { tiles: [await tileTemplate()] }; } catch { tilesNow = { url: TILEJSON_URL }; }
      if (disposed) return;
      map = new maplibregl.Map({
        container, style: buildStyle(palette(), tilesNow, data), center: demo?.at ?? [-0.0753, 51.5054], zoom: 13,
        attributionControl: false, pitchWithRotate: false, maxPitch: 0, fadeDuration: 0,
      });
      map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");
      map.touchZoomRotate.disableRotation();
      mapRef.current = map;
      window.__verstaMap = map;
      setMapReady(true);
    })();
    dark.addEventListener("change", restyle);
    return () => {
      disposed = true;
      dark.removeEventListener("change", restyle);
      markers.current.clear(); riderMarker.current = null; mapRef.current = null; setMapReady(false);
      map?.remove();
    };
  }, []);

  /* the markers of the places in the list, and the rider */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const shown = list.slice(0, MAP_MARKERS);
    const keep = new Set(shown.map((l) => l.place.id));
    for (const [id, m] of markers.current) if (!keep.has(id)) { m.marker.remove(); markers.current.delete(id); }
    shown.forEach((l, i) => {
      if (markers.current.has(l.place.id)) { const m = markers.current.get(l.place.id)!; m.el.firstElementChild!.textContent = String(i + 1); return; }
      const outer = document.createElement("div");
      const el = document.createElement("button");
      el.type = "button"; el.className = "vm-stop"; el.setAttribute("aria-label", `${l.place.name}, show in the list`);
      const dot = document.createElement("span");
      dot.className = "vm-stop-dot"; dot.textContent = String(i + 1);
      el.append(dot); outer.append(el);
      el.addEventListener("click", (e) => { e.stopPropagation(); setSelected(l.place.id); });
      const marker = new maplibregl.Marker({ element: outer, anchor: "center" }).setLngLat(l.place.at).addTo(map);
      markers.current.set(l.place.id, { marker, el });
    });
    if (here) {
      if (!riderMarker.current) {
        const outer = document.createElement("div");
        outer.style.pointerEvents = "none";
        const el = document.createElement("div");
        el.className = "vm-rider no-heading"; el.setAttribute("aria-hidden", "true");
        const pip = document.createElement("div");
        pip.className = "vm-pip"; el.append(pip); outer.append(el);
        riderMarker.current = new maplibregl.Marker({ element: outer, anchor: "center" }).setLngLat(here).addTo(map);
      } else riderMarker.current.setLngLat(here);
    } else if (riderMarker.current) { riderMarker.current.remove(); riderMarker.current = null; }
    // Frame the rider and the places once for each new list, not on every fix.
    const key = `${listKey}|${here ? "h" : "n"}`;
    if (fitted.current !== key && (here || list.length > 0)) {
      fitted.current = key;
      const b = new maplibregl.LngLatBounds();
      if (here) b.extend(here);
      list.forEach((l) => b.extend(l.place.at));
      if (list.length === 0 && here) map.jumpTo({ center: here, zoom: 14.5 });
      else map.fitBounds(b, { padding: 44, maxZoom: 16, duration: 0 });
    }
  }, [mapReady, listKey, here]);

  useEffect(() => {
    for (const [id, m] of markers.current) m.el.classList.toggle("is-next", id === selected);
  }, [selected, mapReady, listKey]);

  /* ---- playing ---- */
  async function ensureMixer(): Promise<Mixer> {
    if (mixer.current) return mixer.current;
    const m = createMixer({ baseUrl: "", virtual: demo !== null, owner: "nearby" });
    mixer.current = m;
    try { await m.unlock(); } catch { /* a blocked context stays silent; the panel still shows */ }
    return m;
  }

  async function play(place: Place): Promise<void> {
    const story = place.stories[0];
    if (!story || playable(place) !== "yes") return;
    const mine = ++token.current;
    setSelected(place.id);
    const mx = await ensureMixer();
    if (mine !== token.current || !alive.current) return;
    mx.stopVoice(0.2);
    const { text, caption } = await storyText(place, story.id);
    if (mine !== token.current || !alive.current) return;
    const paras = text.paras.length > 0 ? text.paras : [];
    const pic = story.pic ? absolute(`${packBase(place.pack)}${story.pic}`) : null;
    setPlaying({ place, storyId: story.id, title: story.title, pic, caption, text: { ...text, paras }, para: 0, paused: false, dur: story.dur });
    const handle = mx.playVoice(absolute(`${packBase(place.pack)}${story.audio}`), {
      estimatedSeconds: story.dur,
      breaks: text.breaks,
      onTime: (s) => {
        if (mine !== token.current) return;
        setPlaying((p) => (p ? { ...p, para: paraAt(s, p.text.marks, p.text.paras, p.dur) } : p));
      },
    });
    handle.done.then(
      () => {
        if (mine !== token.current || !alive.current) return;
        setPlaying(null);
        const next = pending.current.shift();
        if (next) playRef.current(next);
      },
      () => { /* stopped or replaced: whoever did that has already set the panel */ },
    );
  }
  playRef.current = (p) => { void play(p); };
  useEffect(() => { nearbyPlaying.value = playing !== null; }, [playing]);
  /** True when the place is known (the places file has loaded), so a caller can retry until it is. */
  nearbyControls.play = (id) => { const p = places.find((x) => x.id === id); if (p) void play(p); return !!p; };
  nearbyControls.stop = stop;

  function stop(): void {
    token.current++;
    pending.current = [];
    mixer.current?.stopVoice(0.4);
    // at once, not after the next render: a second Back pressed straight after must close the screen
    nearbyPlaying.value = false;
    setPlaying(null);
  }
  /** A tap on the story text: one paragraph on (+1) or back (-1). Past either end it stops or restarts the story. */
  function stepPara(delta: 1 | -1): void {
    const p = playingRef.current;
    if (!p) return;
    const marks = p.text.marks;
    const last = p.text.paras.length - 1;
    const to = p.para + delta;
    if (to > last) { stop(); return; }
    if (to < 0) { void play(p.place); return; }
    const t = marks?.[to];
    if (t !== undefined) mixer.current?.seekVoiceTo?.(Math.max(0, t - 0.1));
    setPlaying({ ...p, para: to });
  }
  function onPanelClick(e: MouseEvent): void {
    if ((e.target as HTMLElement).closest("button")) return;
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    stepPara(e.clientX - box.left < box.width / 3 ? -1 : 1);
  }
  function togglePause(): void {
    const p = playingRef.current;
    if (!p) return;
    if (p.paused) mixer.current?.resumeVoice(); else mixer.current?.pauseVoice();
    setPlaying({ ...p, paused: !p.paused });
  }
  async function toggleAuto(): Promise<void> {
    if (auto) { setAuto(false); pending.current = []; return; }
    watcher.current.reset();
    setAuto(true);
    await ensureMixer(); // made on this tap, so a walk-up story is allowed to sound
  }

  async function togglePocket(): Promise<void> {
    setPocketNote("");
    if (placeWatchOn.value) { stopPlaceWatch(); return; }
    if ((await startPlaceWatch()) === "refused") setPocketNote(REFUSED_NOTE);
  }

  /* the preview opens with a story playing */
  useEffect(() => {
    if (demo?.playing && list.length > 0 && !playingRef.current) void play(list[0]!.place);
  }, [demo, listKey]);

  /* leaving the screen stops the story and releases the audio */
  useEffect(() => () => { nearbyPlaying.value = false; nearbyControls.play = null; nearbyControls.stop = null; }, []);
  useEffect(() => () => {
    token.current++;
    try { mixer.current?.stopVoice(0.1); mixer.current?.dispose?.(); } catch { /* already gone */ }
    mixer.current = null;
  }, []);

  const close = (): void => { nearbyOpen.value = false; };
  const routeName = (id: string): string => packIndex.value.find((e) => e.id === id)?.name ?? id;

  function row(i: number, place: Place, dist: number | null) {
    const can = playable(place);
    const first = place.stories[0]!;
    const isNow = playing?.place.id === place.id;
    return (
      <li key={place.id} class={`nb-row${selected === place.id ? " selected" : ""}`} data-testid="nearby-row" id={`nb-${place.id}`}>
        <span class="nb-num" aria-hidden="true">{i + 1}</span>
        <div class="nb-main">
          <b>{place.name}</b>
          <small>{routeName(place.pack)}{dist !== null ? `, ${fmtDist(dist)}` : ""}</small>
          {first.title !== place.name ? <span class="nb-story">{first.title}</span> : null}
          {can === "needs-app" ? <small class="nb-note">This route needs a newer app.</small> : null}
          {can === "download" || can === "downloading" ? <small class="nb-note">Download the route to hear this</small> : null}
        </div>
        {can === "yes"
          ? <button type="button" class={`btn small ${isNow ? "ghost" : "play"} nb-btn`} aria-label={`Play ${first.title}`} onClick={() => void play(place)}>{isNow ? "Playing" : "Play"}</button>
          : can === "needs-app" ? null
          : <button type="button" class="btn small ghost nb-btn" disabled={can === "downloading"} onClick={() => { void import("../routes/store").then((m) => m.routeStore.fetch(place.pack)); }}>{can === "downloading" ? "Downloading" : "Download route"}</button>}
      </li>
    );
  }

  return (
    <div class="nearby" data-testid="nearby">
      <div class="nb-top">
        <h2>Nearby places</h2>
        <button type="button" class="btn ghost" onClick={close}>Close</button>
      </div>
      {where === "denied" ? <p class="nb-lead" role="status" data-testid="nearby-nogps">Allow location to see places near you.</p> : null}
      {where === "waiting" ? <p class="nb-lead" role="status">Finding where you are.</p> : null}
      <div class="nb-map"><div ref={host} class="versta-map" data-testid="nearby-map" /></div>
      <div class="switchlist nb-switch">
        <button type="button" role="switch" aria-checked={auto} class="switchrow" onClick={() => void toggleAuto()}>
          <span class="swtext"><b>Play when I get there</b><small>Plays a place's story once when you reach it, with the app open.</small></span>
          <span class="swstate">{auto ? "On" : "Off"}</span>
        </button>
        <button type="button" role="switch" aria-checked={native && placeWatchOn.value} class="switchrow" disabled={!native} data-testid="pocket-switch" onClick={() => void togglePocket()}>
          <span class="swtext"><b>Tell me when I pass a place</b><small>{native ? "Keeps watching your location with the screen off. Turns itself off after 8 hours." : "In the Android app"}</small></span>
          {native ? <span class="swstate">{placeWatchOn.value ? "On" : "Off"}</span> : null}
        </button>
      </div>
      {pocketNote ? <p class="nb-lead nb-note-warn" role="status" data-testid="pocket-note">{pocketNote}</p> : null}
      {failed ? <p class="nb-lead" role="status">The places could not be loaded. Check your connection and try again.</p> : null}
      {!failed && file && where === "found" && list.length === 0 ? <p class="nb-lead">No places within 3 km of you.</p> : null}
      <ol class="nb-list" data-testid="nearby-list">
        {list.map((l, i) => row(i, l.place, here ? l.dist : null))}
      </ol>
      {playing ? (
        <div class="scene nb-scene" role="dialog" aria-label="Story" data-testid="nearby-panel">
          <div class={`scene-bg ${playing.pic ? "" : "none"}`} style={playing.pic ? { backgroundImage: `url("${playing.pic}")` } : undefined} />
          <div class="scene-shade" />
          <div class="scene-top">
            <button type="button" class="sbtn" data-testid="nearby-back" onClick={stop}>Back</button>
            <span class="label scene-label">{playing.place.name}</span>
          </div>
          <div class="scene-body" data-testid="nearby-tap" onClick={onPanelClick}>
            <h2>{playing.title}</h2>
            {playing.text.paras.length > 0 ? <p class="scene-text" key={playing.para} aria-live="polite" data-testid="nearby-text">{playing.text.paras[playing.para]}</p> : null}
            <button type="button" class="sr-only" onClick={() => stepPara(1)}>Next part</button>
            <button type="button" class="sr-only" onClick={() => stepPara(-1)}>Previous part</button>
          </div>
          <div class="scene-foot">
            {playing.text.paras.length > 1 ? (
              <div class="ticks" aria-label={`Paragraph ${playing.para + 1} of ${playing.text.paras.length}`}>
                {playing.text.paras.map((_, i) => <i key={i} class={i <= playing.para ? "on" : ""} />)}
              </div>
            ) : null}
            <div class="scene-btns">
              <button type="button" class="sbtn main" onClick={togglePause}>{playing.paused ? "Resume" : "Pause"}</button>
              <button type="button" class="sbtn" onClick={stop}>Stop</button>
            </div>
            {playing.caption ? <div class="scene-cap">{playing.caption}</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
