import type { ExpressionSpecification, StyleSpecification } from "maplibre-gl";

/**
 * The map style: an Admiralty chart. Land buff, shoal blue water, quiet green parks, plain road lines.
 * MapLibre cannot read CSS variables, so the two palettes repeat the values of src/styles/tokens.css
 * (land, shoal, ink, muted, line, mark, warn). Park and road tints are chart-only and live here.
 */
export interface Palette {
  land: string; water: string; park: string; ink: string; muted: string; line: string; mark: string; warn: string;
  building: string; roadMinor: string; roadMajor: string; roadCasing: string; rail: string;
}

export const LIGHT: Palette = {
  land: "#EDE0B2", water: "#D8E8F0", park: "#D4DDA6", ink: "#0E2233", muted: "#566978", line: "#B9C8CC",
  mark: "#A61C6E", warn: "#B4540A",
  building: "#DCCB96", roadMinor: "#9C8F66", roadMajor: "#5E5336", roadCasing: "#F6EDCB", rail: "#7A8A93",
};
export const DARK: Palette = {
  land: "#3A3418", water: "#12283A", park: "#2D3A1E", ink: "#DDE7EA", muted: "#8FA3AF", line: "#274052",
  mark: "#F07CC0", warn: "#F0A050",
  building: "#463F1F", roadMinor: "#8A8260", roadMajor: "#C2B88C", roadCasing: "#2A2611", rail: "#6B7F8B",
};

export const GLYPHS = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";
export const TILEJSON_URL = "https://tiles.openfreemap.org/planet";
export const ATTRIBUTION =
  '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">&copy; OpenStreetMap contributors</a> ' +
  '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>';

const REG = ["Noto Sans Regular"];
const BOLD = ["Noto Sans Bold"];
const ITALIC = ["Noto Sans Italic"];
const NAME: ExpressionSpecification = ["coalesce", ["get", "name:latin"], ["get", "name"]];

const w = (...stops: [number, number][]): ExpressionSpecification =>
  ["interpolate", ["exponential", 1.4], ["zoom"], ...stops.flat()] as ExpressionSpecification;

/** Empty GeoJSON, the starting data of the route sources. */
export const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

export interface RouteData {
  lines: GeoJSON.FeatureCollection;
  asides: GeoJSON.FeatureCollection;
  cue: GeoJSON.FeatureCollection;
  /** Dashed guide from the rider to where they are heading before the route is under them. */
  guide: GeoJSON.FeatureCollection;
  /** The way back to the route while off it. */
  detour: GeoJSON.FeatureCollection;
  /** Ring where the detour rejoins the route. */
  rejoin: GeoJSON.FeatureCollection;
}

export const ROUTE_SOURCES = { lines: "route-lines", asides: "route-asides", cue: "route-cue", guide: "route-guide", detour: "route-detour", rejoin: "route-rejoin" } as const;

type Layer = StyleSpecification["layers"][number];

export function buildStyle(p: Palette, tiles: { url?: string; tiles?: string[] }, data: RouteData): StyleSpecification {
  const road = (cls: string[]): ExpressionSpecification => ["all", ["in", ["get", "class"], ["literal", cls]], ["!=", ["get", "brunnel"], "tunnel"]];
  const layers: Layer[] = [
    { id: "land", type: "background", paint: { "background-color": p.land } },
    { id: "landcover", type: "fill", source: "ofm", "source-layer": "landcover", filter: ["in", ["get", "class"], ["literal", ["grass", "wood", "farmland"]]], paint: { "fill-color": p.park, "fill-opacity": 0.55 } },
    { id: "landuse-green", type: "fill", source: "ofm", "source-layer": "landuse", filter: ["in", ["get", "class"], ["literal", ["park", "cemetery", "pitch", "playground", "garden", "recreation_ground", "village_green", "allotments"]]], paint: { "fill-color": p.park } },
    { id: "park", type: "fill", source: "ofm", "source-layer": "park", paint: { "fill-color": p.park, "fill-opacity": 0.8 } },
    { id: "water", type: "fill", source: "ofm", "source-layer": "water", paint: { "fill-color": p.water } },
    { id: "waterway", type: "line", source: "ofm", "source-layer": "waterway", paint: { "line-color": p.water, "line-width": w([8, 0.6], [14, 2], [18, 6]) } },
    { id: "building", type: "fill", source: "ofm", "source-layer": "building", minzoom: 15, paint: { "fill-color": p.building, "fill-opacity": ["interpolate", ["linear"], ["zoom"], 15, 0, 16, 0.5] } },

    { id: "road-tunnel", type: "line", source: "ofm", "source-layer": "transportation", filter: ["all", ["==", ["get", "brunnel"], "tunnel"], ["in", ["get", "class"], ["literal", ["motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service"]]]], paint: { "line-color": p.roadMinor, "line-opacity": 0.45, "line-dasharray": [2, 2], "line-width": w([12, 0.8], [16, 3]) } },
    { id: "rail", type: "line", source: "ofm", "source-layer": "transportation", filter: ["all", ["==", ["get", "class"], "rail"], ["!=", ["get", "brunnel"], "tunnel"]], minzoom: 11, paint: { "line-color": p.rail, "line-width": w([11, 0.5], [16, 1.4]) } },
    { id: "road-path", type: "line", source: "ofm", "source-layer": "transportation", minzoom: 13, filter: road(["path", "track", "pedestrian"]), paint: { "line-color": p.roadMinor, "line-dasharray": [2, 1.6], "line-width": w([13, 0.5], [16, 1.6], [18, 3]) } },
    { id: "road-minor-casing", type: "line", source: "ofm", "source-layer": "transportation", minzoom: 14, filter: road(["minor", "service"]), layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": p.roadCasing, "line-width": w([14, 1.8], [16, 5], [18, 14]) } },
    { id: "road-minor", type: "line", source: "ofm", "source-layer": "transportation", minzoom: 12, filter: road(["minor", "service"]), layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": p.roadMinor, "line-width": w([12, 0.5], [14, 1], [16, 2.2], [18, 6]) } },
    { id: "road-mid-casing", type: "line", source: "ofm", "source-layer": "transportation", minzoom: 12.5, filter: road(["tertiary"]), layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": p.roadCasing, "line-width": w([12, 1.4], [14, 4.4], [16, 7], [18, 18]) } },
    { id: "road-mid", type: "line", source: "ofm", "source-layer": "transportation", minzoom: 12.5, filter: road(["tertiary"]), layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": p.roadMajor, "line-width": w([12, 0.6], [14, 1.8], [16, 3], [18, 8]) } },
    { id: "road-major-casing", type: "line", source: "ofm", "source-layer": "transportation", filter: road(["primary", "secondary", "trunk", "motorway"]), layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": p.roadCasing, "line-width": w([8, 1.2], [14, 5], [16, 8], [18, 20]) } },
    { id: "road-major", type: "line", source: "ofm", "source-layer": "transportation", filter: road(["primary", "secondary", "trunk", "motorway"]), layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": p.roadMajor, "line-width": w([8, 0.6], [14, 2.4], [16, 3.8], [18, 10]) } },

    // The route, under the labels so street names stay readable across it.
    ...routeLayers(p),

    { id: "water-name", type: "symbol", source: "ofm", "source-layer": "water_name", layout: { "text-field": NAME, "text-font": ITALIC, "text-size": w([8, 11], [14, 15]), "text-letter-spacing": 0.15, "symbol-placement": "point" }, paint: { "text-color": p.ink, "text-halo-color": p.water, "text-halo-width": 1.6 } },
    { id: "waterway-name", type: "symbol", source: "ofm", "source-layer": "waterway", minzoom: 13, filter: ["has", "name"], layout: { "text-field": NAME, "text-font": ITALIC, "text-size": 13, "symbol-placement": "line", "text-letter-spacing": 0.1 }, paint: { "text-color": p.ink, "text-halo-color": p.water, "text-halo-width": 1.6 } },
    {
      id: "road-name", type: "symbol", source: "ofm", "source-layer": "transportation_name", minzoom: 13,
      layout: { "text-field": NAME, "text-font": BOLD, "symbol-placement": "line", "text-size": w([13, 10.5], [16, 13.5], [18, 16]), "text-max-angle": 40, "text-padding": 4, "symbol-spacing": 280, "text-letter-spacing": 0.02, "text-pitch-alignment": "viewport" },
      paint: { "text-color": p.ink, "text-halo-color": p.land, "text-halo-width": 2.2, "text-halo-blur": 0.3 },
    },
    {
      id: "place-minor", type: "symbol", source: "ofm", "source-layer": "place", filter: ["in", ["get", "class"], ["literal", ["suburb", "neighbourhood", "quarter", "village", "hamlet"]]], minzoom: 11, maxzoom: 17,
      layout: { "text-field": NAME, "text-font": REG, "text-size": w([11, 11], [15, 15]), "text-transform": "uppercase", "text-letter-spacing": 0.12, "text-max-width": 7 },
      paint: { "text-color": p.muted, "text-halo-color": p.land, "text-halo-width": 2 },
    },
    {
      id: "place-major", type: "symbol", source: "ofm", "source-layer": "place", filter: ["in", ["get", "class"], ["literal", ["city", "town", "island"]]],
      layout: { "text-field": NAME, "text-font": BOLD, "text-size": w([6, 13], [12, 20]), "text-transform": "uppercase", "text-letter-spacing": 0.1, "text-max-width": 8 },
      paint: { "text-color": p.ink, "text-halo-color": p.land, "text-halo-width": 2.2 },
    },
  ];
  return {
    version: 8,
    glyphs: GLYPHS,
    sources: {
      ofm: { type: "vector", ...tiles, maxzoom: 14, attribution: ATTRIBUTION },
      [ROUTE_SOURCES.lines]: { type: "geojson", data: data.lines },
      [ROUTE_SOURCES.asides]: { type: "geojson", data: data.asides },
      [ROUTE_SOURCES.cue]: { type: "geojson", data: data.cue },
      [ROUTE_SOURCES.guide]: { type: "geojson", data: data.guide },
      [ROUTE_SOURCES.detour]: { type: "geojson", data: data.detour },
      [ROUTE_SOURCES.rejoin]: { type: "geojson", data: data.rejoin },
    },
    layers,
  };
}

/**
 * Route lines carry `state` (done, now, later) and `tunnel` (the foot tunnel is dashed, with no casing).
 * Dash arrays cannot be data driven, so each state has a solid and a dashed layer.
 */
function routeLayers(p: Palette): Layer[] {
  const src = ROUTE_SOURCES.lines;
  const solid = (s: string): ExpressionSpecification => ["all", ["==", ["get", "state"], s], ["!=", ["get", "tunnel"], true]];
  const dashed = (s: string): ExpressionSpecification => ["all", ["==", ["get", "state"], s], ["==", ["get", "tunnel"], true]];
  const round = { "line-cap": "round", "line-join": "round" } as const;
  const casing = (id: string, s: string, width: ExpressionSpecification): Layer =>
    ({ id, type: "line", source: src, filter: solid(s), layout: round, paint: { "line-color": p.land, "line-width": width, "line-opacity": s === "later" ? 0.7 : 1 } });
  const line = (id: string, s: string, color: string, width: ExpressionSpecification, opacity: number): Layer =>
    ({ id, type: "line", source: src, filter: solid(s), layout: round, paint: { "line-color": color, "line-width": width, "line-opacity": opacity } });
  const dash = (id: string, s: string, color: string, width: ExpressionSpecification, opacity: number): Layer =>
    ({ id, type: "line", source: src, filter: dashed(s), layout: { "line-join": "round" }, paint: { "line-color": color, "line-width": width, "line-opacity": opacity, "line-dasharray": [1.6, 1.4] } });
  const later = w([10, 2.4], [16, 4.5]);
  const done = w([10, 3], [16, 5.5]);
  const now = w([10, 4], [16, 8]);
  return [
    casing("route-later-casing", "later", w([10, 4], [16, 7.5])),
    line("route-later", "later", p.mark, later, 0.4),
    dash("route-later-dash", "later", p.mark, later, 0.55),
    casing("route-done-casing", "done", w([10, 4.6], [16, 8.5])),
    line("route-done", "done", p.muted, done, 0.9),
    dash("route-done-dash", "done", p.muted, done, 0.9),
    casing("route-now-casing", "now", w([10, 5.6], [16, 11.5])),
    line("route-now", "now", p.mark, now, 1),
    dash("route-now-dash", "now", p.mark, now, 1),
    { id: "guide-casing", type: "line", source: ROUTE_SOURCES.guide, layout: round, paint: { "line-color": p.land, "line-width": w([10, 4], [16, 8]) } },
    { id: "guide", type: "line", source: ROUTE_SOURCES.guide, layout: { "line-join": "round" }, paint: { "line-color": p.ink, "line-width": w([10, 2.4], [16, 4.5]), "line-dasharray": [1.4, 1.4] } },
    { id: "detour-casing", type: "line", source: ROUTE_SOURCES.detour, layout: round, paint: { "line-color": p.land, "line-width": w([10, 5.6], [16, 11.5]) } },
    { id: "detour", type: "line", source: ROUTE_SOURCES.detour, layout: { "line-join": "round" }, paint: { "line-color": p.warn, "line-width": w([10, 3.6], [16, 7]), "line-dasharray": [1.4, 1.2] } },
    { id: "detour-rejoin", type: "circle", source: ROUTE_SOURCES.rejoin, paint: { "circle-radius": w([10, 8], [16, 15]), "circle-color": p.land, "circle-opacity": 0.5, "circle-stroke-color": p.warn, "circle-stroke-width": 3.4 } },
    {
      id: "route-asides", type: "circle", source: ROUTE_SOURCES.asides,
      paint: { "circle-radius": w([10, 2], [16, 4.2]), "circle-color": p.land, "circle-stroke-color": p.ink, "circle-stroke-width": 1.4, "circle-opacity": 0.95, "circle-stroke-opacity": 0.7 },
    },
    {
      id: "route-cue", type: "circle", source: ROUTE_SOURCES.cue,
      paint: { "circle-radius": w([10, 8], [16, 15]), "circle-color": p.mark, "circle-opacity": 0, "circle-stroke-color": p.mark, "circle-stroke-width": 3.4 },
    },
  ];
}
