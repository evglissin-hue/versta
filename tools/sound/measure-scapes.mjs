// Measures every soundscape alone through the real mixer (the Sound check screen of the production build) and prints
// the TRIM_DB table for src/audio/soundscapes.ts under its five limits. Run it after a recipe or a recording changes.
//
//   npm run build && npx vite preview --port 4181 --strictPort &
//   node tools/sound/measure-scapes.mjs [http://localhost:4181] [name,name,...]   (CHROME_PATH=... for another Chromium)
//
// Each soundscape plays for 24 s; the readings are taken in one-second means. The trims in force are subtracted, so
// the table is right whatever the build was measured with (a trim is a plain gain on the soundscape's bus). Limits:
//   speech band (250 Hz to 4 kHz) energy mean -21.5 dBFS, overall -21, phone band (300 Hz to 8 kHz) -21.5,
//   bursts (the loudest tenth of the seconds): phone band -19.5, above 4 kHz -26; the tunnel capped at +5 dB.
import { chromium } from "../../node_modules/playwright-core/index.mjs";
import { readFileSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:4181";
const only = process.argv[3] ? process.argv[3].split(",") : null;
const cat = JSON.parse(readFileSync(new URL("../../src/audio/catalogue.json", import.meta.url), "utf8"));
const src = readFileSync(new URL("../../src/audio/soundscapes.ts", import.meta.url), "utf8");
const table = /export const TRIM_DB: Record<string, number> = \{([\s\S]*?)\};/.exec(src)?.[1] ?? "";
const inForce = Object.fromEntries([...table.matchAll(/"?([a-z-]+)"?:\s*(-?[0-9.]+)/g)].map((m) => [m[1], Number(m[2])]));

const LIMITS = { mid: -21.5, all: -21, phone: -21.5, phoneBurst: -19.5, highBurst: -26, tunnelCap: 5 };
const emean = (a) => 10 * Math.log10(a.reduce((s, v) => s + 10 ** (v / 10), 0) / a.length);
const pct = (a, q) => { const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(q * b.length))]; };

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? undefined, args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto(`${BASE}/`);
await page.getByRole("button", { name: "Sound check" }).first().click();
await page.waitForTimeout(800);

const trims = {};
for (const [name, v] of Object.entries(cat.soundscapes)) {
  if (only && !only.includes(name)) continue;
  await page.getByRole("button", { name: `Play ${v.label}`, exact: true }).first().click();
  await page.waitForTimeout(3500);
  const xs = [];
  for (let i = 0; i < 240; i++) { const l = await page.evaluate(() => window.__verstaAudio?.levels() ?? null); if (l) xs.push(l); await page.waitForTimeout(100); }
  await page.getByRole("button", { name: `Stop ${v.label}`, exact: true }).first().click().catch(() => {});
  await page.waitForTimeout(3500);
  const off = inForce[name] ?? 0;
  const blocks = (k) => { const b = []; for (let i = 0; i + 10 <= xs.length; i += 10) b.push(emean(xs.slice(i, i + 10).map(k)) - off); return b; };
  const all = blocks((l) => l.bed.all), mid = blocks((l) => l.bed.mid), high = blocks((l) => l.bed.high), ph = blocks((l) => l.phone.bed);
  const c = {
    mid: LIMITS.mid - emean(mid), all: LIMITS.all - emean(all), phone: LIMITS.phone - emean(ph),
    "phone bursts": LIMITS.phoneBurst - pct(ph, 0.9), "high bursts": LIMITS.highBurst - pct(high, 0.9),
  };
  let [by, t] = Object.entries(c).sort((a, b) => a[1] - b[1])[0];
  if (name === "tunnel" && t > LIMITS.tunnelCap) { t = LIMITS.tunnelCap; by = "cap"; }
  trims[name] = Math.round(t * 10) / 10;
  console.log(`${name.padEnd(14)} trim ${trims[name].toFixed(1).padStart(5)} dB  limited by ${by}  (in force ${off})`);
}
await browser.close();
console.log("\nexport const TRIM_DB: Record<string, number> = {");
console.log("  " + Object.entries(trims).map(([k, v]) => `${k.includes("-") ? `"${k}"` : k}: ${v}`).join(", ") + ",");
console.log("};");
