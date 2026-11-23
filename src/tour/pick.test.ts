import { describe, expect, it } from "vitest";
import { PACKS, loaded } from "../../tests/unit/packs";
import { pickPractice, practiceStates } from "./pick";

describe.each(PACKS.map((p) => [p.entry.id, p] as const))("the practice ride on %s", (_id, p) => {
  const pack = loaded(p);
  const pick = pickPractice(pack);
  it("finds a stop, a turn and a passing-by story, all with sound", () => {
    expect(pick).not.toBeNull();
    const k = pick!.stop;
    const story = pack.stops[k]!.stories.find((s) => s.kind === "core")!;
    expect(k).toBeGreaterThanOrEqual(1);
    expect(story.audio).toBeTruthy();
    expect(story.paras.length).toBeGreaterThanOrEqual(3);
    expect(pick!.cue.seg).toBe(k);
    expect(["left", "right", "slight_left", "slight_right", "sharp_left", "sharp_right"]).toContain(pick!.cue.turn);
    expect(pick!.cue.audio).toBeTruthy();
    expect(pick!.cue.quiet).not.toBe(true);
    expect(pick!.asides.length).toBeGreaterThan(0);
    expect(pick!.asides.every((a) => a.audio)).toBe(true);
  });
  it("makes states the director's rules accept for each step", () => {
    const st = practiceStates(pack, pick!);
    expect(st.before.status).toBe("riding");
    expect(st.before.nextCue).toBe(pick!.cue);
    expect(st.before.toCue!).toBeGreaterThan(0);
    expect(st.before.toCue!).toBeLessThanOrEqual(150);
    expect(st.before.arrived).toEqual(Array.from({ length: pick!.stop }, (_, i) => i));
    expect(st.atStop.status).toBe("at_stop");
    expect(st.atStop.arrived).toContain(pick!.stop);
    expect(st.after.status).toBe("riding");
    expect(st.after.seg).toBe(pick!.stop + 1);
    expect(st.after.toStop).toBeGreaterThan(150);
    expect(st.after.nextCue).toBeNull();
  });
});
