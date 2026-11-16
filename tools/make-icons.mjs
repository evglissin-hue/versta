// Draws the Versta icon (a verst post: striped roadside post, magenta cap, on chart buff) and rasterises it.
// Usage: node tools/make-icons.mjs   (needs Chrome at /usr/bin/google-chrome, or set CHROME_PATH)
import { chromium } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
mkdirSync(out, { recursive: true });

const INK = "#0E2233", PAPER = "#F5F8F5", BUFF = "#EDE0B2", MARK = "#A61C6E", WATER = "#D8E8F0";

/** `scale` shrinks the drawing around the centre so the maskable version keeps its safe zone. */
function svg(scale) {
  const t = scale === 1 ? "" : ` transform="translate(256 256) scale(${scale}) translate(-256 -256)"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <clipPath id="body"><rect x="178" y="176" width="156" height="272"/></clipPath>
    <pattern id="stripes" width="64" height="64" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)">
      <rect width="64" height="64" fill="${PAPER}"/><rect width="32" height="64" fill="${INK}"/>
    </pattern>
  </defs>
  <rect width="512" height="512" fill="${BUFF}"/>
  <g${t}>
    <rect x="40" y="440" width="432" height="72" fill="${WATER}"/>
    <rect x="40" y="440" width="432" height="8" fill="${INK}"/>
    <rect x="178" y="176" width="156" height="272" fill="url(#stripes)" clip-path="url(#body)"/>
    <rect x="178" y="176" width="156" height="272" fill="none" stroke="${INK}" stroke-width="10"/>
    <path d="M166 180 L346 180 L318 104 L194 104 Z" fill="${MARK}" stroke="${INK}" stroke-width="10" stroke-linejoin="miter"/>
    <rect x="210" y="76" width="92" height="28" fill="${MARK}" stroke="${INK}" stroke-width="10"/>
  </g>
</svg>
`;
}

const files = [
  { name: "icon.svg", svg: svg(1), size: null },
  { name: "icon-192.png", svg: svg(1), size: 192 },
  { name: "icon-512.png", svg: svg(1), size: 512 },
  // Maskable icons are cropped to a circle of 40 percent of the width: keep the drawing inside it.
  { name: "icon-maskable-512.png", svg: svg(0.62), size: 512 },
];

writeFileSync(join(out, "icon.svg"), files[0].svg);
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome", args: ["--no-sandbox"] });
for (const f of files) {
  if (!f.size) continue;
  const page = await browser.newPage({ viewport: { width: f.size, height: f.size } });
  await page.setContent(`<style>html,body{margin:0}svg{display:block;width:${f.size}px;height:${f.size}px}</style>${f.svg}`);
  await page.screenshot({ path: join(out, f.name) });
  await page.close();
  console.log("wrote", f.name);
}
await browser.close();
