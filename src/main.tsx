import "@fontsource/barlow-condensed/500.css";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "@fontsource/newsreader/400.css";
import "@fontsource/newsreader/400-italic.css";
import { render } from "preact";
import { App } from "./app";
import { initNative } from "./native";
import { isNative } from "./native/platform";
import { closeTopOverlay } from "./ui/back";
import "./styles/tokens.css";
import "./styles/app.css";

// Inside the Android app: no service worker, and the back button closes the top sheet before anything else.
initNative();
window.addEventListener("versta:back", (e) => { if (closeTopOverlay()) e.preventDefault(); });

render(<App />, document.getElementById("app")!);
// Inside the Android app: tell the native side this code started, so a new version is not rolled back.
if (isNative()) void import("./update/native").then((m) => m.markReady()).catch(() => {});
