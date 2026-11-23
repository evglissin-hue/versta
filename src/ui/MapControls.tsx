import { useEffect, useRef, useState } from "preact/hooks";
import { nav, settings, updateSettings } from "../state";
import { Squiggle } from "./icons";
import { RECENTRE_MS, RECENTRE_WHOLE_MS, following, lastTouch, resumeFollow, ringDemo, showWholeRoute, wholeRoute } from "./uistate";

/** How long the word "Recentre" stays beside the button once the rider has left following. */
const LABEL_MS = 5000;
/** Above this speed (metres per second) the rider counts as moving; once moving, it takes a slower pace to stop counting. */
const MOVING = 1.5;
const STILL = 0.8;

const Arrow = ({ hollow }: { hollow?: boolean }) => (
  <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true" class="mc-icon">
    <path d="M16 3 L27 28 L16 22 L5 28 Z" fill={hollow ? "none" : "currentColor"} stroke="currentColor" stroke-width="2.4" stroke-linejoin="round" />
  </svg>
);
const Needle = () => (
  <svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true" class="mc-icon">
    <text x="16" y="9" text-anchor="middle" class="mc-n">N</text>
    <path d="M16 11 L21 21 L16 19.5 L11 21 Z" fill="currentColor" />
    <path d="M16 31 L21 21 L16 19.5 L11 21 Z" fill="none" stroke="var(--ink)" stroke-width="1.8" stroke-linejoin="round" />
  </svg>
);
/** The two round buttons on the map while riding: follow (and course up or north up), and the whole route. */
export function MapControls() {
  const n = nav.value;
  const follow = following.value;
  const whole = wholeRoute.value;
  const courseUp = settings.value.courseUp;
  const auto = settings.value.autoRecentre;
  const touch = lastTouch.value;
  const demo = ringDemo.value;
  const [label, setLabel] = useState(!follow);

  // the word Recentre shows for the first few seconds after leaving following
  useEffect(() => {
    if (follow) { setLabel(false); return; }
    setLabel(true);
    const t = window.setTimeout(() => setLabel(false), LABEL_MS);
    return () => window.clearTimeout(t);
  }, [follow]);

  // moving, with a little hysteresis so a wobble in speed does not restart the wait
  const speed = n.speedAvg ?? n.fix?.speed ?? 0;
  const was = useRef(false);
  const moving = speed > (was.current ? STILL : MOVING);
  was.current = moving;
  const active = !follow && auto && n.status === "riding" && moving && demo === null;
  const delay = whole ? RECENTRE_WHOLE_MS : RECENTRE_MS;

  // following comes back by itself after the wait, and any touch restarts it
  useEffect(() => {
    if (!active) return;
    const t = window.setTimeout(resumeFollow, delay);
    return () => window.clearTimeout(t);
  }, [active, touch, delay]);

  if (n.status !== "riding" && n.status !== "at_stop") return null;

  const state = !follow ? "free" : courseUp ? "course" : "north";
  const ringOn = !follow && (active || demo !== null);
  const onFollow = (): void => {
    if (!follow) resumeFollow();
    else updateSettings({ courseUp: !courseUp });
  };
  const aria = state === "free" ? "Recentre" : state === "course" ? "Following. Course up. Tap for north up" : "Following. North up. Tap for course up";

  return (
    <div class="map-controls" data-testid="map-controls">
      <button
        type="button" class={`mc-btn small ${whole ? "on" : ""}`} data-testid="whole-route" aria-pressed={whole}
        aria-label={whole ? "Back to following" : "Show the whole route"}
        onClick={() => (whole ? resumeFollow() : showWholeRoute())}
      >
        <Squiggle size={28} class="mc-icon" />
      </button>
      <div class="mc-row">
        {state === "free" && label ? <span class="mc-label" data-testid="recentre-label">Recentre</span> : null}
        <button type="button" class={`mc-btn follow ${state}`} data-testid="follow" data-state={state} aria-label={aria} onClick={onFollow}>
          {state === "course" ? <Arrow /> : state === "north" ? <Needle /> : <Arrow hollow />}
          {ringOn ? (
            <svg class="mc-ring" viewBox="0 0 66 66" aria-hidden="true" data-testid="recentre-ring">
              <circle
                key={`${touch}|${delay}`} cx="33" cy="33" r="30" pathLength="100"
                style={demo !== null
                  ? { animationDuration: `${delay}ms`, animationDelay: `-${Math.round(delay * demo)}ms`, animationPlayState: "paused" }
                  : { animationDuration: `${delay}ms` }}
              />
            </svg>
          ) : null}
        </button>
      </div>
    </div>
  );
}
