import { useEffect } from "preact/hooks";
import { packIndex, screen } from "./state";
import type { PackIndexEntry } from "./types";
import { isNative } from "./native/platform";
import { syncVersions } from "./offline";
import { enterDemo, useDemoKeys } from "./ui/Demo";
import { Home } from "./ui/Home";
import { Ride } from "./ui/Ride";
import { Nearby } from "./ui/Nearby";
import { Recordings } from "./ui/Recordings";
import { SoundCheck } from "./ui/SoundCheck";
import { nearbyOpen, recordingsOpen, soundCheckOpen } from "./ui/uistate";
import { Tour } from "./tour/Tour";

const query = new URLSearchParams(location.search);
const demo = query.get("demo") === "ride";

export function App() {
  useEffect(() => {
    if (demo) { void enterDemo(query.get("step") ?? "riding"); return; }
    if (isNative()) { void import("./routes/store").then((m) => m.routeStore.start()); return; }
    void fetch(`${import.meta.env.BASE_URL}packs/index.json`)
      .then((r) => r.json() as Promise<{ packs: PackIndexEntry[] }>)
      .then((j) => { packIndex.value = j.packs; void syncVersions(j.packs); })
      .catch(() => { /* offline on first visit: the home screen shows no routes */ });
  }, []);
  useDemoKeys(demo);
  return (
    <>
      {screen.value === "ride" ? <Ride /> : <Home />}
      {nearbyOpen.value && screen.value === "home" ? <Nearby /> : null}
      {soundCheckOpen.value ? <SoundCheck /> : null}
      {recordingsOpen.value ? <Recordings /> : null}
      <Tour />
    </>
  );
}
