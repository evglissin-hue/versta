import type { ComponentChildren } from "preact";

export function Sheet({ kicker, title, onClose, children, testid }: { kicker?: string; title: string; onClose: () => void; children: ComponentChildren; testid?: string }) {
  return (
    <div class="sheet" role="dialog" aria-label={title} data-testid={testid}>
      <div class="sheet-in">
        <div class="sheet-top">
          <div>{kicker ? <span class="label">{kicker}</span> : null}<h2>{title}</h2></div>
          <button type="button" class="btn ghost" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}
