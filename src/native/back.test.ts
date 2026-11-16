import { afterEach, describe, expect, it, vi } from "vitest";

// handleBack touches window only through these two calls, so a minimal stand-in is enough in the node test env.
const listeners: Array<(e: { defaultPrevented: boolean; preventDefault(): void }) => void> = [];
class FakeEvent { defaultPrevented = false; constructor(public type: string, _init?: unknown) {} preventDefault() { this.defaultPrevented = true; } }
vi.stubGlobal("CustomEvent", FakeEvent);
vi.stubGlobal("window", { dispatchEvent: (e: FakeEvent) => { listeners.forEach((l) => l(e)); return !e.defaultPrevented; } });

const { handleBack } = await import("./index");
const { openStop, screen } = await import("../state");

afterEach(() => { listeners.length = 0; openStop.value = null; screen.value = "home"; });

describe("handleBack", () => {
  it("lets a screen handle it first", () => {
    listeners.push((e) => e.preventDefault());
    const min = vi.fn();
    expect(handleBack(min)).toBe("handled-by-ui");
    expect(min).not.toHaveBeenCalled();
  });
  it("closes an open stop sheet", () => {
    openStop.value = 2;
    expect(handleBack(vi.fn())).toBe("closed-sheet");
    expect(openStop.value).toBeNull();
  });
  it("never leaves a ride", () => {
    screen.value = "ride";
    const min = vi.fn();
    expect(handleBack(min)).toBe("stayed-in-ride");
    expect(min).not.toHaveBeenCalled();
  });
  it("minimizes from the home screen instead of exiting", () => {
    const min = vi.fn();
    expect(handleBack(min)).toBe("minimized");
    expect(min).toHaveBeenCalledOnce();
  });
});
