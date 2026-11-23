/** The tour overlay, rendered once by the app above every screen (task 34): the dim with its hole, and the card. */
import { useEffect, useRef } from "preact/hooks";
import { endTutorial, tourEngine as engine } from "./index";
import { HOLE_PAD, padBox, placeCard, type Box } from "./engine";
import { Picture } from "./Pictures";

const EASE_MS = 200;
const RADIUS = 10;

const reduced = (): boolean => { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };

/** The dim over the whole screen with a rounded hole in it, as one path: filled with the even-odd rule. */
function dimPath(w: number, h: number, b: Box | null): string {
  const all = `M0 0H${w}V${h}H0Z`;
  if (!b) return all;
  const r = Math.min(RADIUS, b.w / 2, b.h / 2);
  return `${all}M${b.x + r} ${b.y}h${b.w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${b.h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(b.w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(b.h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}Z`;
}

/** Where the hole was, kept across steps so it can ease from there. */
const mem: { cur: Box | null; last: Box | null; from: Box | null; start: number; seen: number } = { cur: null, last: null, from: null, start: 0, seen: -1 };
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export function Tour() {
  const v = engine.view.value;
  if (v.kind === "closed") return null;
  return <Overlay />;
}

function Overlay() {
  const v = engine.view.value;
  const step = engine.step;
  const total = engine.steps.value.length;
  const index = engine.index.value;
  const ready = engine.ready.value;
  const busy = engine.busy.value;
  const cardEl = useRef<HTMLDivElement>(null);
  const pathEl = useRef<SVGPathElement>(null);
  const holeEl = useRef<HTMLDivElement>(null);
  useEffect(() => { mem.cur = null; mem.last = null; mem.from = null; mem.seen = -1; }, []);
  const picKey = v.kind === "card" ? v.card.id : step?.id ?? "";

  // the hole follows its target while the step shows, and eases between steps; the card sits above or below it
  useEffect(() => {
    let raf = 0;
    const m = mem;
    let tight = false;
    let fullH = 0;
    let tightH = 0;
    let lastKey = "";
    const run = (now: number): void => {
      raf = requestAnimationFrame(run);
      const path = pathEl.current, hole = holeEl.current, card = cardEl.current;
      if (!path || !card) return;
      const vw = window.innerWidth, vh = window.innerHeight;
      path.parentElement!.setAttribute("viewBox", `0 0 ${vw} ${vh}`);
      const s = engine.step;
      const el = s && engine.ready.value ? s.target() : null;
      let box: Box | null = null;
      if (el) {
        const r = el.getBoundingClientRect();
        const goal = padBox({ x: r.left, y: r.top, w: r.width, h: r.height }, HOLE_PAD);
        if (engine.changed.value !== m.seen) { m.seen = engine.changed.value; m.from = m.cur ?? m.last; m.start = now; }
        const t = reduced() || !m.from ? 1 : Math.min(1, (now - m.start) / EASE_MS);
        const e = 1 - (1 - t) * (1 - t);
        box = m.from && t < 1 ? { x: lerp(m.from.x, goal.x, e), y: lerp(m.from.y, goal.y, e), w: lerp(m.from.w, goal.w, e), h: lerp(m.from.h, goal.h, e) } : goal;
        m.cur = box;
      } else {
        if (m.cur) m.last = m.cur;
        m.cur = null;
      }
      path.setAttribute("d", dimPath(vw, vh, box));
      if (hole) {
        hole.style.display = box ? "block" : "none";
        if (box) { hole.style.left = `${box.x}px`; hole.style.top = `${box.y}px`; hole.style.width = `${box.w}px`; hole.style.height = `${box.h}px`; }
      }
      const key = `${picKey}|${vw}|${vh}|${box ? "h" : "n"}`;
      if (key !== lastKey) { lastKey = key; tight = false; card.classList.remove("tight"); fullH = 0; tightH = 0; }
      if (!tight) fullH = card.offsetHeight; else tightH = card.offsetHeight;
      if (!box) {
        const w = Math.min(420, vw - 32);
        card.style.left = `${Math.round((vw - w) / 2)}px`; card.style.width = `${w}px`;
        card.style.top = `${Math.max(16, Math.round((vh - card.offsetHeight) / 2))}px`;
        card.style.maxHeight = "";
        return;
      }
      const pl = placeCard(box, { w: vw, h: vh }, { h: tight && tightH ? tightH : fullH });
      const wantTight = fullH > (pl.side === "below" ? vh - (box.y + box.h) - 32 : box.y - 32);
      if (wantTight !== tight) { tight = wantTight; card.classList.toggle("tight", tight); }
      const h = tight ? (tightH || fullH) : fullH;
      const fin = placeCard(box, { w: vw, h: vh }, { h });
      card.style.left = `${fin.x}px`; card.style.width = `${fin.w}px`; card.style.top = `${fin.y}px`;
      card.style.maxHeight = `${Math.max(0, Math.round(fin.side === "below" ? vh - (box.y + box.h) - 32 : box.y - 32))}px`;
    };
    raf = requestAnimationFrame(run);
    return () => cancelAnimationFrame(raf);
  }, [picKey]);

  // keyboard: Escape closes; Right or Enter is Next and Left is Previous when focus is on the card or nowhere
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") { e.preventDefault(); endTutorial(); return; }
      const at = e.target as Element | null;
      const free = !at || at === document.body || at === cardEl.current;
      if (!free || !engine.step) return;
      if (e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); if (engine.ready.value) engine.next(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); engine.prev(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // focus goes to the card whenever it changes
  useEffect(() => { cardEl.current?.focus({ preventScroll: true }); }, [picKey]);

  const last = index >= total - 1;
  const pic = v.kind === "card" ? v.card.picture : step?.picture;
  const title = v.kind === "card" ? v.card.title : step?.title ?? "";
  const line = v.kind === "card" ? v.card.line : step?.line ?? "";
  return (
    <div class="tour" data-testid="tour">
      <svg class="tour-dim" preserveAspectRatio="none" aria-hidden="true"><path ref={pathEl} fill-rule="evenodd" d="M0 0H1V1H0Z" /></svg>
      <div class={`tour-hole ${step?.interactive ? "open" : ""}`} ref={holeEl} data-testid="tour-hole" style={{ display: "none" }} />
      <div class="tour-card" ref={cardEl} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} data-testid="tour-card" data-step={step?.id ?? (v.kind === "card" ? v.card.id : "")}>
        <div class="tour-head">
          {pic ? <Picture name={pic} /> : null}
          <span class="label tour-count" data-testid="tour-count">{v.kind === "step" ? `${index + 1} of ${total}` : ""}</span>
          {v.kind === "step" ? <button type="button" class="btn small ghost tour-close" data-testid="tour-close" onClick={() => endTutorial()}>Close</button> : null}
        </div>
        <h2 class="tour-title" data-testid="tour-title">{title}</h2>
        <p class="tour-line">{line}</p>
        <div class="tour-acts">
          {v.kind === "card"
            ? v.card.actions.map((a) => <button type="button" key={a.label} class={`btn ${a.primary ? "play" : "ghost"}`} disabled={busy} onClick={a.run}>{busy && a.primary && v.card.id === "intro" ? "Starting" : a.label}</button>)
            : (
              <>
                {index > 0 ? <button type="button" class="btn ghost" data-testid="tour-prev" onClick={() => engine.prev()}>Previous</button> : null}
                <button type="button" class="btn play" data-testid="tour-next" disabled={!ready} onClick={() => engine.next()}>{last ? "Done" : "Next"}</button>
              </>
            )}
        </div>
      </div>
    </div>
  );
}
