import { useEffect, useRef } from "preact/hooks";
import { effect } from "@preact/signals";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./map.css";
import { nav, openStop, settings } from "../state";
import { finishOpen, joinChoice, joinTarget } from "../ui/uistate";
import { tileTemplate } from "../offline";
import type { LngLat, NavState, Pack } from "../types";
import { lineLength, metresPerPixel, splitAt } from "./geometry";
import { DARK, EMPTY, LIGHT, ROUTE_SOURCES, TILEJSON_URL, buildStyle, type Palette, type RouteData } from "./style";

export interface MapViewProps {
  pack: Pack;
  /** Keep the camera on the rider. The map sets it false itself when the rider drags the map. */
  follow: boolean;
  onFollowChange(follow: boolean): void;
  onStopTap(stop: number): void;
  /** A tap on the map itself, not on a stop. */
  onMapTap?(): void;
}

declare global { interface Window { __verstaMap?: maplibregl.Map } }

const FOLLOW_ZOOM = 16.2;
const PAD_TOP = 150;
const PAD_BOTTOM = 230;
/** Share of the height a bottom sheet may cover (see .sheet.bottom in app.css). */
const SHEET_SHARE = 0.62;
const GLIDE_MS = 900;
const darkQuery = (): MediaQueryList => window.matchMedia("(prefers-color-scheme: dark)");

const pad2 = (i: number): string => String(i + 1).padStart(2, "0");

function point(coord: LngLat, props: Record<string, unknown> = {}): GeoJSON.Feature<GeoJSON.Point> {
  return { type: "Feature", properties: props, geometry: { type: "Point", coordinates: coord } };
}

/** Route lines split into the ridden part, the stretch being ridden and the part still to come. */
function routeLines(pack: Pack, n: NavState): GeoJSON.FeatureCollection {
  const overview = n.status === "idle" || n.status === "locating" || n.status === "to_start";
  const features: GeoJSON.Feature[] = [];
  const add = (coords: LngLat[], state: string, tunnel: boolean): void => {
    if (coords.length > 1) features.push({ type: "Feature", properties: { state, tunnel }, geometry: { type: "LineString", coordinates: coords } });
  };
  pack.segments.forEach((seg, i) => {
    if (i === 0 || seg.length < 2) return;
    const tunnel = pack.stops[i]?.id === "foot-tunnel";
    if (overview) add(seg, "now", tunnel);
    else if (n.status === "finished" || i < n.seg) add(seg, "done", tunnel);
    else if (i === n.seg) {
      const [before, after] = splitAt(seg, Math.min(n.alongSeg, lineLength(seg)));
      add(before, "done", tunnel);
      add(after, "now", tunnel);
    } else add(seg, "later", tunnel);
  });
  return { type: "FeatureCollection", features };
}

/** The outer div is the marker element (MapLibre positions it); the button inside is ours to style. */
function createStopElement(pack: Pack, i: number, onTap: (i: number) => void): { outer: HTMLDivElement; el: HTMLButtonElement } {
  const outer = document.createElement("div");
  const el = document.createElement("button");
  outer.append(el);
  el.type = "button";
  el.className = "vm-stop";
  el.setAttribute("aria-label", `Stop ${i + 1}, ${pack.stops[i]?.name ?? ""}`);
  const dot = document.createElement("span");
  dot.className = "vm-stop-dot";
  dot.textContent = pad2(i);
  el.append(dot);
  el.addEventListener("click", (e) => { e.stopPropagation(); onTap(i); });
  return { outer, el };
}

function createRiderElement(): { outer: HTMLDivElement; el: HTMLDivElement; acc: HTMLDivElement; arrow: HTMLDivElement } {
  const outer = document.createElement("div");
  outer.style.pointerEvents = "none";
  const el = document.createElement("div");
  outer.append(el);
  el.className = "vm-rider no-heading";
  el.setAttribute("aria-hidden", "true");
  const acc = document.createElement("div");
  acc.className = "vm-acc";
  const arrow = document.createElement("div");
  arrow.className = "vm-arrow";
  arrow.innerHTML = '<svg viewBox="-26 -26 52 52"><path d="M0 -26 L13 -10 L-13 -10 Z"/></svg>';
  const pip = document.createElement("div");
  pip.className = "vm-pip";
  el.append(acc, arrow, pip);
  return { outer, el, acc, arrow };
}

export function MapView(props: MapViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const live = useRef(props);
  live.current = props;
  const camera = useRef<(force: boolean) => void>(() => {});

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    const pack = props.pack;
    let disposed = false;
    let map: maplibregl.Map | null = null;
    const cleanups: (() => void)[] = [];

    const data: RouteData = { lines: EMPTY, asides: EMPTY, cue: EMPTY, guide: EMPTY, detour: EMPTY, rejoin: EMPTY };
    data.asides = { type: "FeatureCollection", features: pack.asides.map((a) => point(a.at, { id: a.id })) };

    const paletteNow = (): Palette => (darkQuery().matches ? DARK : LIGHT);

    void (async () => {
      let tiles: { url?: string; tiles?: string[] };
      try { tiles = { tiles: [await tileTemplate()] }; } catch { tiles = { url: TILEJSON_URL }; }
      if (disposed) return;

      const m = new maplibregl.Map({
        container,
        style: buildStyle(paletteNow(), tiles, data),
        center: pack.stops[0]?.at ?? [-0.1, 51.5],
        zoom: 11,
        attributionControl: false,
        touchPitch: false,
        pitchWithRotate: false,
        maxPitch: 0,
        fadeDuration: 0,
      });
      map = m;
      m.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");
      window.__verstaMap = m;

      /* ---- stops ---- */
      const stopEls = pack.stops.map((s, i) => {
        const { outer, el } = createStopElement(pack, i, (k) => live.current.onStopTap(k));
        new maplibregl.Marker({ element: outer, anchor: "center" }).setLngLat(s.at).addTo(m);
        return el;
      });

      /* ---- rider ---- */
      const rider = createRiderElement();
      const riderMarker = new maplibregl.Marker({ element: rider.outer, anchor: "center" });
      let riderOn = false;
      let shown: LngLat | null = null;
      let glide: { from: LngLat; to: LngLat; t0: number } | null = null;
      let raf = 0;
      let accuracy = 0;
      let heading: number | null = null;

      const paintAccuracy = (): void => {
        if (!shown) return;
        const px = accuracy / metresPerPixel(shown[1], m.getZoom());
        const size = Math.min(Math.max(px * 2, 0), 600);
        rider.acc.style.display = size < 24 ? "none" : "block";
        rider.acc.style.width = `${size}px`;
        rider.acc.style.height = `${size}px`;
      };
      const paintHeading = (): void => {
        rider.arrow.style.transform = heading === null ? "" : `rotate(${heading - m.getBearing()}deg)`;
      };
      const step = (now: number): void => {
        raf = 0;
        if (!glide) return;
        const t = Math.min(1, (now - glide.t0) / GLIDE_MS);
        shown = [glide.from[0] + (glide.to[0] - glide.from[0]) * t, glide.from[1] + (glide.to[1] - glide.from[1]) * t];
        riderMarker.setLngLat(shown);
        if (t < 1) raf = requestAnimationFrame(step); else glide = null;
      };
      const moveRider = (to: LngLat): void => {
        if (!riderOn) { riderOn = true; shown = to; riderMarker.setLngLat(to).addTo(m); return; }
        glide = { from: shown ?? to, to, t0: performance.now() };
        if (!raf) raf = requestAnimationFrame(step);
      };
      const hideRider = (): void => {
        if (riderOn) { riderMarker.remove(); riderOn = false; shown = null; glide = null; }
      };
      m.on("rotate", paintHeading);
      m.on("zoom", paintAccuracy);
      cleanups.push(() => { if (raf) cancelAnimationFrame(raf); });

      /* ---- camera ---- */
      let mode: "overview" | "follow" | null = null;
      let overviewHadRider = false;
      /** A bottom sheet covers the lower part of the map: the stop sheet, or the finish logbook. */
      const sheetUp = (n: NavState): boolean => openStop.value !== null || (n.status === "finished" && finishOpen.value);
      const frame = (force: boolean): void => {
        const n = nav.value;
        const p = live.current;
        const target = riderTarget(n);
        const h = container.clientHeight || 800;
        const lowered = sheetUp(n);
        const padBottom = lowered ? Math.round(h * SHEET_SHARE) : PAD_BOTTOM;
        if ((n.status === "riding" || n.status === "at_stop") && target) {
          if (!p.follow) { mode = null; return; }
          const bearing = settings.value.courseUp ? (n.routeBearing ?? m.getBearing()) : 0;
          const first = mode !== "follow" || force;
          mode = "follow";
          m.easeTo({
            center: target, zoom: FOLLOW_ZOOM, bearing, padding: { top: PAD_TOP, bottom: padBottom, left: 0, right: 0 },
            duration: first ? 700 : GLIDE_MS, easing: first ? (t: number) => t * (2 - t) : (t: number) => t, essential: true,
          });
        } else if (n.status === "idle" || n.status === "locating" || n.status === "to_start" || n.status === "finished") {
          const hasRider = !!target && n.status !== "finished";
          if (mode === "overview" && !force && hasRider === overviewHadRider) return;
          if (mode === "overview" && !p.follow && !force) return;
          mode = "overview";
          overviewHadRider = hasRider;
          const b = new maplibregl.LngLatBounds();
          for (const seg of pack.segments) for (const c of seg) b.extend(c);
          for (const s of pack.stops) b.extend(s.at);
          if (hasRider && target) b.extend(target);
          const top = n.status === "finished" && lowered ? 48 : Math.min(PAD_TOP, h * 0.25);
          const bottom = lowered ? Math.round(h * SHEET_SHARE) : Math.min(PAD_BOTTOM, h * 0.3);
          m.fitBounds(b, { padding: { top, bottom, left: 40, right: 40 }, maxZoom: 16, duration: 700, bearing: 0, essential: true });
        }
      };
      camera.current = frame;

      const riderTarget = (n: NavState): LngLat | null => {
        if (n.snapped && !n.offRoute) return n.snapped;
        return n.fix ? [n.fix.lng, n.fix.lat] : null;
      };

      /* ---- data updates ---- */
      const setData = (id: string, fc: GeoJSON.FeatureCollection): void => {
        const src = m.getSource(id) as maplibregl.GeoJSONSource | undefined;
        src?.setData(fc);
      };
      let lastKey = "";
      let lastCue = "";
      let lastGuide = "";
      let wasLowered = false;
      let lastDetour = "";
      const pushNav = (n: NavState): void => {
        const key = `${n.status}|${n.seg}|${Math.round(n.alongSeg / 4)}`;
        if (key !== lastKey) {
          lastKey = key;
          data.lines = routeLines(pack, n);
          setData(ROUTE_SOURCES.lines, data.lines);
        }
        const cueFc: GeoJSON.FeatureCollection = n.nextCue && (n.status === "riding" || n.status === "at_stop")
          ? { type: "FeatureCollection", features: [point(n.nextCue.at)] } : EMPTY;
        const cueKey = JSON.stringify(cueFc);
        if (cueKey !== lastCue) { lastCue = cueKey; data.cue = cueFc; setData(ROUTE_SOURCES.cue, cueFc); }
        const rider0 = n.fix ? ([n.fix.lng, n.fix.lat] as LngLat) : null;
        const join = joinChoice(n, pack);
        const goal = join ? (join.chosen === "route" && join.at.route ? join.at.route : join.at.start) : null;
        const guideFc: GeoJSON.FeatureCollection = rider0 && goal
          ? { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [rider0, goal] } }] } : EMPTY;
        const guideKey = JSON.stringify(guideFc);
        if (guideKey !== lastGuide) { lastGuide = guideKey; data.guide = guideFc; setData(ROUTE_SOURCES.guide, guideFc); }
        const d = n.offRoute ? n.detour ?? null : null;
        const line = d && d.line.length > 1 ? d.line : null;
        const detourFc: GeoJSON.FeatureCollection = line
          ? { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: line } }] } : EMPTY;
        const rejoinFc: GeoJSON.FeatureCollection = line ? { type: "FeatureCollection", features: [point(line[line.length - 1]!)] } : EMPTY;
        const detourKey = JSON.stringify(detourFc);
        if (detourKey !== lastDetour) { lastDetour = detourKey; data.detour = detourFc; data.rejoin = rejoinFc; setData(ROUTE_SOURCES.detour, detourFc); setData(ROUTE_SOURCES.rejoin, rejoinFc); }
        stopEls.forEach((el, i) => {
          const next = (n.status === "riding" || n.status === "to_start" || n.status === "locating") && i === n.seg;
          el.classList.toggle("is-next", next);
          el.classList.toggle("is-arrived", n.arrived.includes(i) && !next);
        });
        const t = riderTarget(n);
        if (!t) { hideRider(); return; }
        moveRider(t);
        accuracy = n.fix?.accuracy ?? 0;
        heading = n.fix?.heading ?? n.routeBearing ?? null;
        rider.el.classList.toggle("no-heading", heading === null);
        rider.el.classList.toggle("is-off", n.offRoute);
        paintHeading();
        paintAccuracy();
      };

      const seedLines = (): void => {
        data.lines = routeLines(pack, nav.value);
        setData(ROUTE_SOURCES.lines, data.lines);
      };
      m.on("load", () => { seedLines(); pushNav(nav.peek()); frame(true); });

      cleanups.push(effect(() => {
        const n = nav.value;
        void settings.value;
        void joinTarget.value;
        const lowered = sheetUp(n);
        if (!m.loaded() && !m.getSource(ROUTE_SOURCES.lines)) return;
        pushNav(n);
        frame(lowered !== wasLowered);
        wasLowered = lowered;
      }));

      /* ---- a tap on the bare map ---- */
      m.on("click", () => live.current.onMapTap?.());

      /* ---- the rider taking the camera ---- */
      m.on("movestart", (e) => { if ((e as { originalEvent?: unknown }).originalEvent && live.current.follow) live.current.onFollowChange(false); });

      /* ---- light and dark, live ---- */
      const q = darkQuery();
      const onScheme = (): void => { m.setStyle(buildStyle(paletteNow(), tiles, data)); };
      q.addEventListener("change", onScheme);
      cleanups.push(() => q.removeEventListener("change", onScheme));
    })();

    return () => {
      disposed = true;
      cleanups.forEach((c) => c());
      camera.current = () => {};
      map?.remove();
      if (window.__verstaMap === map) delete window.__verstaMap;
    };
    // One map per mount; later prop changes are read through `live`.
  }, [props.pack]);

  useEffect(() => { if (props.follow) camera.current(true); }, [props.follow]);

  return <div ref={host} class="versta-map" />;
}
