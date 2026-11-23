/**
 * The tour's small pictures (task 34): 64 by 48 SVGs stroked like the menu icons, in ink, with the mark colour for the
 * moving part. They move with CSS transforms and opacity only (tour.css), so nothing on the page shifts. Under
 * reduced motion the animation is off and each picture shows its first frame.
 */
import type { ComponentChildren } from "preact";
import type { PictureName } from "./engine";

const S = { fill: "none", stroke: "currentColor", "stroke-width": 2.4, "stroke-linecap": "round", "stroke-linejoin": "round" } as const;
const M = { ...S, stroke: "var(--mark)" } as const;

const frame = (name: string, body: ComponentChildren) => (
  <svg class={`tp tp-${name}`} viewBox="0 0 64 48" width="64" height="48" aria-hidden="true" data-picture={name}>{body}</svg>
);

const PICTURES: Record<PictureName, () => ComponentChildren> = {
  speaker: () => frame("speaker", (
    <>
      <path d="M8 19 H15 L24 12 V36 L15 29 H8 Z" {...S} />
      <path class="arc a1" d="M31 19 Q35 24 31 29" {...M} />
      <path class="arc a2" d="M37 14 Q45 24 37 34" {...M} />
      <path class="arc a3" d="M43 9 Q55 24 43 39" {...M} />
    </>
  )),
  // an arrow bending left, with a distance ticking down beside it
  turn: () => frame("turn", (
    <>
      <path d="M22 42 V24 Q22 16 14 16 H10" {...S} />
      <path class="mv head" d="M16 10 L9 16 L16 22" {...M} />
      <text class="d d1" x="34" y="29" font-size="15" font-family="var(--f-display)" font-weight="700" fill="var(--ink)">150</text>
      <text class="d d2" x="34" y="29" font-size="15" font-family="var(--f-display)" font-weight="700" fill="var(--ink)">100</text>
      <text class="d d3" x="34" y="29" font-size="15" font-family="var(--f-display)" font-weight="700" fill="var(--ink)">50 m</text>
    </>
  )),
  // a map arrow recentring on a ring
  mapbtn: () => frame("mapbtn", (
    <>
      <circle cx="32" cy="24" r="17" {...S} />
      <path class="mv nav" d="M32 12 L40 35 L32 30 L24 35 Z" {...M} />
    </>
  )),
  // a progress bar filling
  dock: () => frame("dock", (
    <>
      <rect x="6" y="10" width="52" height="28" rx="3" {...S} />
      <path d="M12 19 H34" {...S} />
      <rect x="12" y="27" width="40" height="5" rx="1" {...S} stroke-width="1.8" />
      <rect class="fill" x="12" y="27" width="40" height="5" rx="1" fill="var(--mark)" />
    </>
  )),
  // a finger tapping the right of a text block as the ticks move on
  tap: () => frame("tap", (
    <>
      <path d="M8 12 H44 M8 20 H44 M8 28 H44" {...S} stroke-width="2" />
      <path d="M12 42 H20 M24 42 H32 M36 42 H44" {...S} stroke-width="2" />
      <path class="tick" d="M36 42 H44" {...M} stroke-width="2" />
      <g class="finger">
        <circle cx="52" cy="22" r="5" {...M} />
        <path d="M52 27 V38" {...M} />
      </g>
    </>
  )),
  // a pause sign
  pause: () => frame("pause", (
    <>
      <circle cx="32" cy="24" r="16" {...S} />
      <path class="mv bar b1" d="M26 17 V31" {...M} />
      <path class="mv bar b2" d="M38 17 V31" {...M} />
    </>
  )),
  // a story card sliding down into a bar
  scene: () => frame("scene", (
    <>
      <rect x="8" y="39" width="48" height="6" rx="2" {...S} />
      <rect class="card" x="12" y="4" width="40" height="30" rx="3" {...M} />
    </>
  )),
  // the bar with a stop square
  mini: () => frame("mini", (
    <>
      <rect x="6" y="14" width="52" height="20" rx="3" {...S} />
      <path d="M12 24 H30" {...S} stroke-width="2" />
      <rect class="stopsq" x="43" y="20" width="8" height="8" rx="1" {...M} />
    </>
  )),
  // a marker passing with three sound arcs
  aside: () => frame("aside", (
    <>
      <path d="M4 40 H60" {...S} stroke-width="2" />
      <g class="marker">
        <path d="M16 36 C11 30 10 28 10 25 A6 6 0 0 1 22 25 C22 28 21 30 16 36 Z" {...S} />
        <circle cx="16" cy="25" r="1.8" fill="currentColor" />
      </g>
      <path class="arc a1" d="M32 20 Q36 25 32 30" {...M} />
      <path class="arc a2" d="M38 15 Q46 25 38 35" {...M} />
      <path class="arc a3" d="M44 10 Q56 25 44 40" {...M} />
    </>
  )),
  flag: () => frame("flag", (
    <>
      <path d="M18 44 V6" {...S} />
      <path class="mv flagcloth" d="M18 8 H46 L40 16 L46 24 H18" {...M} />
    </>
  )),
};

export function Picture({ name }: { name: PictureName }) {
  return <>{PICTURES[name]()}</>;
}
