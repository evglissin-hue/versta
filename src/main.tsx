import "@fontsource/barlow-condensed/500.css";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "@fontsource/newsreader/400.css";
import "@fontsource/newsreader/400-italic.css";
import { render } from "preact";
import { App } from "./app";
import "./styles/tokens.css";
import "./styles/app.css";

render(<App />, document.getElementById("app")!);
