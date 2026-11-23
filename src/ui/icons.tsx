/** One family of line icons: currentColor strokes 2.4 wide, round caps and joins, a 32 by 32 view box, fills only for small dots. */
import type { ComponentChildren } from "preact";

interface IconProps { size?: number; class?: string }
const S = { fill: "none", stroke: "currentColor", "stroke-width": 2.4, "stroke-linecap": "round", "stroke-linejoin": "round" } as const;
const svg = (p: IconProps, size: number, body: ComponentChildren) => (
  <svg viewBox="0 0 32 32" width={p.size ?? size} height={p.size ?? size} aria-hidden="true" class={p.class}>{body}</svg>
);

/** Routes: a winding line from a start dot to an end ring. */
export const Squiggle = (p: IconProps) => svg(p, 32, (
  <>
    <path d="M5 25 C5 16 14 21 14 14 C14 8 8 10 10 5 M14 14 C14 9 23 14 25 7" {...S} stroke-width="2.6" />
    <circle cx="5" cy="25" r="2.6" fill="currentColor" />
    <circle cx="25" cy="7" r="2.6" fill="var(--paper)" stroke="currentColor" stroke-width="2.2" />
  </>
));
/** Nearby places: a map pin with a small ring under it. */
export const PinIcon = (p: IconProps) => svg(p, 32, (
  <>
    <path d="M16 20 C11 14 9 11.5 9 8.5 A7 7 0 0 1 23 8.5 C23 11.5 21 14 16 20 Z" {...S} />
    <circle cx="16" cy="8.5" r="2" fill="currentColor" />
    <ellipse cx="16" cy="26" rx="8" ry="2.8" {...S} />
  </>
));
/** Settings: three slider lines with knobs. */
export const SlidersIcon = (p: IconProps) => svg(p, 32, (
  <>
    <path d="M4 8 H28 M4 16 H28 M4 24 H28" {...S} />
    <circle cx="11" cy="8" r="3" fill="var(--paper)" stroke="currentColor" stroke-width="2.4" />
    <circle cx="21" cy="16" r="3" fill="var(--paper)" stroke="currentColor" stroke-width="2.4" />
    <circle cx="13" cy="24" r="3" fill="var(--paper)" stroke="currentColor" stroke-width="2.4" />
  </>
));
/** Tutorial: a play triangle in a circle. */
export const PlayIcon = (p: IconProps) => svg(p, 32, (
  <>
    <circle cx="16" cy="16" r="12" {...S} />
    <path d="M13 10.5 L22 16 L13 21.5 Z" {...S} />
  </>
));
/** About: a lowercase i in a circle. */
export const InfoIcon = (p: IconProps) => svg(p, 32, (
  <>
    <circle cx="16" cy="16" r="12" {...S} />
    <path d="M16 14.5 V22" {...S} />
    <circle cx="16" cy="10.4" r="1.6" fill="currentColor" />
  </>
));
/** A thin right angle for rows that open something. */
export const Chevron = (p: IconProps) => svg(p, 20, <path d="M12 7 L21 16 L12 25" {...S} stroke-width="2.2" />);
