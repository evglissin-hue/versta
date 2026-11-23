import { backPage } from "./uistate";

/** The top of every page but the menu: Back on the left, the page title next to it. */
export function PageBar({ title }: { title: string }) {
  return (
    <div class="pagebar">
      <button type="button" class="btn ghost" data-testid="page-back" onClick={() => { backPage(); }}>Back</button>
      <h2>{title}</h2>
    </div>
  );
}
