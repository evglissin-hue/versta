import { currentDirector } from "../ride";
import { packBase, pack } from "../state";
import type { NowPlaying } from "../types";
import { pad2 } from "./format";
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

  const main = manual ? (lastPara ? "Finish" : "Next") : paused ? "Resume" : "Pause";
  const onMain = () => (manual ? d?.nextParagraph() : d?.togglePause());

  return (
    <div class="scene" role="dialog" aria-label="Story" data-testid="scene">
      <div class={`scene-bg ${pic ? "" : "none"}`} style={pic ? { backgroundImage: pic } : undefined} />
      <div class="scene-shade" />
      <div class="scene-top">
        <span class="label">{pad2(np.stop + 1)} {stop?.name}</span>
        <button type="button" class="sbtn" onClick={() => { sceneOpen.value = false; }}>Back to map</button>
      </div>
      <div class="scene-body">
        {story.tags.length > 0 ? <div class="scene-tags">{story.tags.map((t) => <span class="chip" key={t}>{t}</span>)}</div> : null}
        <h2>{story.title}</h2>
        <p class="scene-text" key={para} aria-live="polite">{story.paras[para]}</p>
      </div>
      <div class="scene-foot">
        <div class="ticks" aria-label={`Paragraph ${para + 1} of ${story.paras.length}`}>
          {story.paras.map((_, i) => <i key={i} class={i <= para ? "on" : ""} />)}
        </div>
        <div class="scene-btns">
          <button type="button" class="sbtn main" onClick={onMain}>{main}</button>
          <button type="button" class="sbtn" onClick={() => d?.skip()}>{more ? "Next story" : "End"}</button>
        </div>
        {story.pic ? <div class="scene-cap">{story.pic.caption}</div> : null}
      </div>
    </div>
  );
}
