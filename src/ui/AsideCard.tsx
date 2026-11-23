import { useState } from "preact/hooks";
import { currentDirector } from "../ride";
import type { Aside } from "../types";

export function AsideCard({ aside }: { aside: Aside }) {
  const [open, setOpen] = useState(false);
  return (
    <div class="aside" data-testid="aside-card">
      <div class="aside-head">
        <span class="label">Passing by</span>
        {aside.tags.map((t) => <span class="chip tag" key={t}>{t}</span>)}
      </div>
      <h3>{aside.title}</h3>
      <button type="button" class={`aside-text ${open ? "open" : ""}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        {aside.text}
        <span class="aside-more">{open ? "Tap to shorten" : "Tap to read it all"}</span>
      </button>
      <button type="button" class="btn ghost" data-testid="aside-stop" onClick={() => currentDirector()?.stopAll()}>Stop</button>
    </div>
  );
}
