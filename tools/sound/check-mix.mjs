// Acceptance check for the sound mix. Runs the production build in headless Chrome with real audio, rides the
// simulator, samples window.__verstaAudio.levels() for 30 s while the first story plays and checks the numbers.
//
//   npm run build && npx vite preview --port 4181 --strictPort &
//   node tools/sound/check-mix.mjs [http://localhost:4181]      (CHROME_PATH=... for another Chromium binary)
//
// The story is paused for a few seconds in the middle so the gap level is measured over a real, long gap, as well
// as the natural pauses between sentences.
import { chromium } from "../../node_modules/playwright-core/index.mjs";

const BASE = process.argv[2] ?? "http://localhost:4181";
const DURATION_S = 30, PAUSE_FROM_S = 14, PAUSE_TO_S = 20, SETTLE_MS = 900;
const mean = (a) => (a.length ? 10 * Math.log10(a.reduce((s, v) => s + 10 ** (v / 10), 0) / a.length) : NaN);
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : "n/a");

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome", args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`${BASE}/?sim=1&speed=5&scale=1`);
await page.getByRole("button", { name: /^Ride/ }).first().click();
await page.waitForFunction(() => window.__versta?.nowPlaying.value?.kind === "story", null, { timeout: 60_000 });
const story = await page.evaluate(() => window.__versta.nowPlaying.value.story?.title ?? "?");

const samples = [];
const t0 = Date.now();
let paused = false, resumed = false;
while ((Date.now() - t0) / 1000 < DURATION_S) {
  const t = (Date.now() - t0) / 1000;
  if (!paused && t >= PAUSE_FROM_S) { paused = true; await page.getByRole("button", { name: /^Pause$/ }).first().click().catch(() => {}); }
  if (paused && !resumed && t >= PAUSE_TO_S) { resumed = true; await page.getByRole("button", { name: /^Resume$/ }).first().click().catch(() => {}); }
  const s = await page.evaluate(() => ({ playing: window.__versta.nowPlaying.value?.kind ?? null, l: window.__verstaAudio?.levels() ?? null }));
  if (s.l) samples.push({ t, playing: s.playing, ...s.l });
  await page.waitForTimeout(80);
}
await browser.close();

// settle: only keep samples where the pocket has been in its state for SETTLE_MS
let since = 0, state = null;
const settled = samples.map((s) => { if (s.pocketClosed !== state) { state = s.pocketClosed; since = s.t; } return { ...s, settled: (s.t - since) * 1000 >= SETTLE_MS }; });
const closed = settled.filter((s) => s.settled && s.pocketClosed);
const open = settled.filter((s) => s.settled && !s.pocketClosed && s.t > 2);
const band = (xs, k) => mean(xs.map((s) => s.bed[k]));
const voiceSpeaking = mean(closed.map((s) => s.voice));
const row = (name, xs) => `${name.padEnd(16)} n=${String(xs.length).padStart(3)}  voice ${f1(mean(xs.map((s) => s.voice))).padStart(6)}  bed all ${f1(band(xs, "all")).padStart(6)}  low ${f1(band(xs, "low")).padStart(6)}  mid ${f1(band(xs, "mid")).padStart(6)}  high ${f1(band(xs, "high")).padStart(6)}`;
console.log(`story: ${story}; ${samples.length} samples over ${DURATION_S} s`);
console.log(row("speech (closed)", closed));
console.log(row("gap (open)", open));

const minAll = Math.min(...samples.filter((s) => s.playing === "story" && s.t > 3).map((s) => s.bed.all));
const dMid = band(open, "mid") - band(closed, "mid"), dLow = band(open, "low") - band(closed, "low"), dHigh = band(open, "high") - band(closed, "high");
console.log(`bed minimum overall while the story plays (after 3 s): ${f1(minAll)} dBFS`);
console.log(`bed mid band below the voice (voice level while speaking ${f1(voiceSpeaking)} dBFS): ${f1(voiceSpeaking - band(closed, "mid"))} dB in speech, ${f1(voiceSpeaking - band(open, "mid"))} dB in gaps`);
console.log(`bed overall below the voice: ${f1(voiceSpeaking - band(closed, "all"))} dB in speech, ${f1(voiceSpeaking - band(open, "all"))} dB in gaps`);
console.log(`gap to speech change: mid ${f1(dMid)} dB, low ${f1(dLow)} dB, high ${f1(dHigh)} dB`);

const checks = [
  ["bed never below -55 dBFS", minAll >= -55],
  ["mid band at least 8 dB lower in speech than in gaps", dMid >= 8],
  ["low band moves by no more than 5 dB", Math.abs(dLow) <= 5],
  ["high band moves by no more than 5 dB", Math.abs(dHigh) <= 5],
  ["both speech and gap samples were found", closed.length > 10 && open.length > 10],
  ["no uncaught page errors", errors.length === 0],
];
for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
if (errors.length) console.log(errors.join("\n"));
process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
