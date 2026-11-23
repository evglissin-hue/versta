import { useState } from "preact/hooks";
import { currentDirector } from "../ride";
import { nowPlaying, openStop, packBase, pack } from "../state";
import type { NowPlaying } from "../types";
import { fmtLeft, pad2, storyLeft } from "./format";
import { canRewind } from "./uistate";
import { sceneOpen } from "./uistate";

type StoryNow = Extract<NonNullable<NowPlaying>, { kind: "story" }>;

export function Scene({ np }: { np: StoryNow }) {
  const p = pack.value;
  if (!p) return null;
  const d = currentDirector();
  const { story, para, paused, manual } = np;
  const stop = p.stops[np.stop];
  const lastPara = para >= story.paras.length - 1;
  const more = (stop?.stories ?? []).some((s) => s.kind === "core" && s.id !== story.id && !d?.heard.has(s.id));
  const pic = story.pic ? `url("${packBase(p.id)}${story.pic.src}")` : null;

  const left = manual ? null : storyLeft(story, para);
  const back = canRewind(manual, d);

  const [flash, setFlash] = useState<{ side: "l" | "r"; n: number } | null>(null);

  /** One paragraph on or back. In the preview there is no director, so the scene moves the paragraph itself. */
  const step = (delta: 1 | -1): void => {
    setFlash((f) => ({ side: delta < 0 ? "l" : "r", n: (f?.n ?? 0) + 1 }));
    if (d) { d.stepPara?.(delta); return; }
    const next = Math.max(0, Math.min(story.paras.length - 1, para + delta));
    if (next !== para) nowPlaying.value = { ...np, para: next };
  };
  const onBodyClick = (e: MouseEvent): void => {
    if ((e.target as HTMLElement).closest("button")) return;
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    step(e.clientX - box.left < box.width / 3 ? -1 : 1);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); e.stopPropagation(); step(e.key === "ArrowRight" ? 1 : -1); }
  };
  const stopStory = (): void => {
    if (d) d.stopAll(); else nowPlaying.value = null;
  };
  const toMap = (): void => { sceneOpen.value = false; openStop.value = null; };

  const main = manual ? (lastPara ? "Finish" : "Next") : paused ? "Resume" : "Pause";
  const onMain = () => (manual ? d?.nextParagraph() : d?.togglePause());

  return (
    <div class="scene" role="dialog" aria-label="Story" data-testid="scene" tabIndex={-1} onKeyDown={onKey}>
      <div class={`scene-bg ${pic ? "" : "none"}`} style={pic ? { backgroundImage: pic } : undefined} />
      <div class="scene-shade" />
      <div class="scene-top">
        <button type="button" class="sbtn" data-testid="scene-back" onClick={stopStory}>Back</button>
        <span class="label scene-label">{pad2(np.stop + 1)} {stop?.name}</span>
        <button type="button" class="sbtn" data-testid="scene-map" onClick={toMap}>Map</button>
      </div>
      <div class="scene-body" data-testid="scene-tap" onClick={onBodyClick}>
        {story.tags.length > 0 ? <div class="scene-tags">{story.tags.map((t) => <span class="chip" key={t}>{t}</span>)}</div> : null}
        <h2>{story.title}</h2>
        <p class="scene-text" key={para} aria-live="polite">{story.paras[para]}</p>
        <button type="button" class="sr-only" onClick={() => step(1)}>Next part</button>
        <button type="button" class="sr-only" onClick={() => step(-1)}>Previous part</button>
        {flash ? <span key={flash.n} class={`tap-chev ${flash.side}`} aria-hidden="true">{flash.side === "l" ? "‹" : "›"}</span> : null}
      </div>
      <div class="scene-foot" data-testid="scene-foot">
        <div class="ticks" aria-label={`Paragraph ${para + 1} of ${story.paras.length}`}>
          {story.paras.map((_, i) => <i key={i} class={i <= para ? "on" : ""} />)}
        </div>
        {left !== null || back ? (
          <div class="scene-meta">
            <div class="scene-left" data-testid="time-left">{left !== null ? fmtLeft(left) : ""}</div>
            {back ? <button type="button" class="sbtn back" onClick={() => d?.rewind?.(15)}>Back 15 s</button> : null}
          </div>
        ) : null}
        <div class="scene-btns">
          <button type="button" class="sbtn main" onClick={onMain}>{main}</button>
          <button type="button" class="sbtn" onClick={() => d?.skip()}>{more ? "Next story" : "Close story"}</button>
        </div>
        {story.pic ? <div class="scene-cap">{story.pic.caption}</div> : null}
      </div>
    </div>
  );
}
