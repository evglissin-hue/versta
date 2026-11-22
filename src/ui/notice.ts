/** The text of the ongoing ride notification (the next turn on the lock screen). Pure: no browser or native APIs. */
import type { NavState, Pack } from "../types";
import { fmtDist, stopLabel, turnWord } from "./format";

export interface NoticeText {
  title: string;
  body: string;
  /** The distance in metres that the body shows, or null when the body is not a distance. For the update throttle. */
  dist: number | null;
}

/** What the notification says for this nav state, or null when there should be none (idle, locating, finished, no pack). */
export function rideNoticeText(nav: NavState, pack: Pack | null): NoticeText | null {
  if (!pack) return null;
  const stops = pack.stops;
  if (nav.status === "idle" || nav.status === "locating" || nav.status === "finished") return null;
  if (nav.status === "at_stop") {
    const after = nav.seg + 1 < stops.length ? stopLabel(pack, nav.seg + 1) : "The end of the route";
    return { title: `At ${stopLabel(pack, nav.seg)}`, body: after, dist: null };
  }
  if (nav.offRoute) return { title: "Off the route", body: "Head back to the line", dist: null };
  const next = stops[nav.seg];
  if (nav.status === "to_start") {
    return { title: `Head for ${next ? stopLabel(pack, nav.seg) : "the start"}`, body: fmtDist(nav.toStop, 20), dist: nav.toStop };
  }
  const c = nav.nextCue;
  if (c && nav.toCue !== null) {
    const word = turnWord(c.turn);
    const title = c.name ? (c.turn === "straight" ? `${word} ${c.name}` : `${word} onto ${c.name}`) : word;
    return { title, body: fmtDist(nav.toCue, 20), dist: nav.toCue };
  }
  if (!next) return null;
  return { title: `Next stop: ${stopLabel(pack, nav.seg)}`, body: fmtDist(nav.toStop), dist: nav.toStop };
}
