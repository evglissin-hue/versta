import type { ComponentChildren } from "preact";

export function Sheet({ kicker, title, onClose, children, testid, bottom }: { kicker?: string; title: string; onClose: () => void; children: ComponentChildren; testid?: string; bottom?: boolean }) {
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
  if (bottom) {
    return (
      <div class="sheet-layer">
        <div class="sheet bottom" role="dialog" aria-label={title} data-testid={testid}>{inner}</div>
      </div>
    );
  }
  return <div class="sheet" role="dialog" aria-label={title} data-testid={testid}>{inner}</div>;
}
