/**
 * The Android app cannot fetch() the site: its pages come from https://localhost and the site sends no cross-origin
 * headers. Found in the iteration 6 hunt: Nearby fetched the site's places.json and always fell back to the copy in
 * the APK, so a new route's places never reached the phone. This test makes fetch refuse every cross-origin URL, as
 * the WebView does, and checks the site's copy still arrives.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const SITE = { version: "site", places: [{ id: "x:a", name: "A", at: [0, 0], radius: 40, pack: "x", kind: "stop", stories: [] }] };
const OWN = { version: "own", places: [] };

vi.mock("../native/platform", () => ({ isNative: () => true }));
const get = vi.fn(async () => ({ status: 200, data: JSON.stringify(SITE), headers: {}, url: "" }));
vi.mock("@capacitor/core", () => ({ CapacitorHttp: { get } }));

describe("places on the Android app", () => {
  afterEach(() => { vi.unstubAllGlobals(); get.mockClear(); });

  it("reach the phone from the site although the WebView refuses cross-origin fetches", async () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } });
    vi.stubGlobal("fetch", async (url: string) => {
      if (/^https?:\/\//.test(url)) throw new TypeError("Failed to fetch (cross-origin, as in the WebView)");
      return new Response(JSON.stringify(OWN), { status: 200 });
    });
    const { loadPlaces } = await import("./library");
    const file = await loadPlaces();
    expect(file.version).toBe("site");
    expect(get).toHaveBeenCalledOnce();
    expect(JSON.parse(store.get("versta:places")!).version).toBe("site");
  });
});
