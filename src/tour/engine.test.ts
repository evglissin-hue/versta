import { describe, expect, it } from "vitest";
import { padBox, placeCard, type Box } from "./engine";

const overlap = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("placeCard", () => {
  const sizes = [{ w: 360, h: 740 }, { w: 390, h: 844 }, { w: 412, h: 915 }, { w: 768, h: 1024 }];
  const holes: Box[] = [
    { x: 8, y: 8, w: 344, h: 110 }, { x: 250, y: 400, w: 100, h: 160 }, { x: 8, y: 600, w: 344, h: 130 },
    { x: 20, y: 300, w: 320, h: 50 }, { x: 8, y: 70, w: 344, h: 400 }, { x: 100, y: 330, w: 10, h: 10 },
  ];
  it("is never over the hole and always on screen, on made-up boxes", () => {
    for (const vp of sizes) for (const hole of holes) for (const ch of [120, 200, 260]) {
      const p = placeCard(hole, vp, { h: ch });
      const card: Box = { x: p.x, y: p.y, w: p.w, h: p.h };
      expect(overlap(card, hole), JSON.stringify({ vp, hole, ch, p })).toBe(false);
      expect(p.x).toBeGreaterThanOrEqual(16);
      expect(p.x + p.w).toBeLessThanOrEqual(vp.w - 16);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y + p.h).toBeLessThanOrEqual(vp.h);
      expect(p.w).toBeLessThanOrEqual(420);
    }
  });
  it("takes the side with more room, 16 px from the hole", () => {
    const top = placeCard({ x: 8, y: 8, w: 300, h: 100 }, { w: 360, h: 740 }, { h: 200 });
    expect(top.side).toBe("below");
    expect(top.y).toBe(108 + 16);
    const bottom = placeCard({ x: 8, y: 600, w: 300, h: 100 }, { w: 360, h: 740 }, { h: 200 });
    expect(bottom.side).toBe("above");
    expect(bottom.y + bottom.h).toBe(600 - 16);
  });
  it("is full width on a phone and 420 px on a tablet", () => {
    expect(placeCard({ x: 0, y: 0, w: 10, h: 10 }, { w: 360, h: 740 }, { h: 100 }).w).toBe(328);
    expect(placeCard({ x: 0, y: 0, w: 10, h: 10 }, { w: 768, h: 1024 }, { h: 100 }).w).toBe(420);
  });
  it("says when the room is too short for the card, and cuts it to the room", () => {
    const p = placeCard({ x: 0, y: 60, w: 360, h: 620 }, { w: 360, h: 740 }, { h: 260 });
    expect(p.fits).toBe(false);
    expect(p.y + p.h).toBeLessThanOrEqual(740);
  });
  it("pads a box on every side", () => {
    expect(padBox({ x: 10, y: 10, w: 20, h: 20 })).toEqual({ x: 2, y: 2, w: 36, h: 36 });
  });
});
