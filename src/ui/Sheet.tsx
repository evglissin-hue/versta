import type { ComponentChildren } from "preact";

export function Sheet({ kicker, title, onClose, children, testid, bottom, modal }: { kicker?: string; title: string; onClose: () => void; children: ComponentChildren; testid?: string; bottom?: boolean; modal?: boolean }) {
  const inner = (
    <div class="sheet-in">
      <div class="sheet-top">
        <div>{kicker ? <span class="label">{kicker}</span> : null}<h2>{title}</h2></div>
        <button type="button" class="btn ghost" onClick={onClose}>Close</button>
      </div>
      {children}
    </div>
  );
  // A bottom sheet leaves the map above it free to tap; the full sheet covers everything.
  // A modal one (outside the ride screen) dims what is behind it and closes when the dimmed part is tapped.
  if (bottom) {
    return (
      <div class={`sheet-layer ${modal ? "modal" : ""}`}>
        {modal ? <div class="scrim" onClick={onClose} /> : null}
        <div class="sheet bottom" role="dialog" aria-label={title} data-testid={testid}>{inner}</div>
      </div>
    );
  }
  return <div class="sheet" role="dialog" aria-label={title} data-testid={testid}>{inner}</div>;
}
