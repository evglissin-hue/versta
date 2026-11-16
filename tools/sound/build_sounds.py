#!/usr/bin/env python3
"""Fetch and process the recorded soundscape loops in public/sounds/.

    python3 tools/sound/build_sounds.py fetch            # download the sources from Wikimedia Commons into --raw
    python3 tools/sound/build_sounds.py process          # cut, filter, normalise and encode into public/sounds
    python3 tools/sound/build_sounds.py report           # print duration, loudness, peak, silence, band levels

Every source is CC0 or public domain (checked in the Commons file metadata, recorded in docs/sound-credits.md).
Commons rate limits hard: requests are spaced and 429 answers are retried after the pause the server asks for.

Processing per sound: mono, cut to one stretch (30 to 45 s, the steadiest by default or a fixed start), high-pass at
60 Hz, normalise to about -26 LUFS, 64 kbps mp3. The app joins the end of the loop to its start with a short
crossfade when it decodes the file (src/audio/loops.ts), so the cut does not need to be seamless.

Needs ffmpeg, ffprobe and numpy. Use `python3 -I` if the raw folder is untrusted.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np

UA = "Versta/0.2 (personal non-commercial project)"
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public" / "sounds"
TARGET_LUFS = -26.0
SR = 44100

# sources.json: name, file (Commons title without the File: prefix), optional start and length in seconds, optional highpass in Hz (default 60).
SOURCES: list[dict] = json.loads((Path(__file__).with_name("sources.json")).read_text())


def api(params: dict) -> dict:
    url = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode({**params, "format": "json"})
    for _ in range(10):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=60) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code != 429:
                raise
            time.sleep(int(e.headers.get("retry-after", "30")) + 5)
    raise RuntimeError("rate limited")


def raw_path(raw: Path, title: str) -> Path:
    return raw / title.replace(" ", "_")


def fetch(raw: Path) -> None:
    raw.mkdir(parents=True, exist_ok=True)
    titles = sorted({s["file"] for s in SOURCES})
    info = api({
        "action": "query", "titles": "|".join("File:" + t for t in titles), "prop": "imageinfo",
        "iiprop": "url|extmetadata", "iiextmetadatafilter": "LicenseShortName|Artist",
    })
    for page in info["query"]["pages"].values():
        title = page["title"][5:]
        ii = page["imageinfo"][0]
        lic = ii["extmetadata"]["LicenseShortName"]["value"].lower()
        if not (lic.startswith("cc0") or lic.startswith("public domain")):
            print(f"SKIP {title}: licence is {lic}")
            continue
        dest = raw_path(raw, title)
        if dest.exists() and dest.stat().st_size > 50_000:
            continue
        for _ in range(8):
            r = subprocess.run(["curl", "-sS", "-A", UA, "-o", str(dest), "-w", "%{http_code}", ii["url"].split("?")[0]], capture_output=True, text=True)
            if r.stdout == "200":
                break
            time.sleep(35)
        print(title, r.stdout, flush=True)
        time.sleep(5)


def decode(path: Path) -> np.ndarray:
    out = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(out, dtype="<f4")


def steadiest(x: np.ndarray, length: float) -> float:
    """Start (seconds) of the stretch whose one second loudness varies least, with no near silence and no clipping."""
    n = int(length)
    sec = len(x) // SR
    if sec <= n:
        return 0.0
    rms = np.array([np.sqrt(np.mean(x[i * SR:(i + 1) * SR] ** 2) + 1e-12) for i in range(sec)])
    db = 20 * np.log10(rms)
    peak = np.array([np.max(np.abs(x[i * SR:(i + 1) * SR])) for i in range(sec)])
    best, at = None, 0
    for s in range(0, sec - n + 1):
        w = db[s:s + n]
        if peak[s:s + n].max() > 0.99 or w.min() < np.median(db) - 12:
            continue
        score = float(np.std(w))
        if best is None or score < best:
            best, at = score, s
    return float(at)


def process(raw: Path) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    by_name: dict[str, dict] = {s["name"]: s for s in SOURCES}
    for name, s in by_name.items():
        src = raw_path(raw, s["file"])
        if not src.exists():
            print(f"missing {src}")
            continue
        x = decode(src)
        length = min(float(s.get("length", 40)), len(x) / SR)
        start = s.get("start")
        if start is None:
            start = steadiest(x, length)
        dst = OUT / f"{name}.mp3"
        # loudnorm in one pass is not exact, so measure and fix with a gain in a second pass
        base = ["ffmpeg", "-v", "error", "-y", "-ss", f"{start:.2f}", "-t", f"{length:.2f}", "-i", str(src), "-ac", "1", "-ar", "44100", "-af", f"highpass=f={s.get('highpass', 60)}:poles=2"]
        tmp = OUT / f"_{name}.wav"
        subprocess.run(base + [str(tmp)], check=True)
        lufs = measure_lufs(tmp)
        gain = TARGET_LUFS - lufs
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(tmp), "-af", f"volume={gain:.2f}dB,alimiter=limit=0.8:level=disabled", "-ac", "1", "-b:a", "64k", str(dst)], check=True)
        tmp.unlink()
        print(f"{name}: {s['file']} start {start:.0f}s length {length:.0f}s gain {gain:+.1f} dB")


def measure_lufs(path: Path) -> float:
    r = subprocess.run(["ffmpeg", "-nostats", "-i", str(path), "-af", "ebur128=peak=true", "-f", "null", "-"], capture_output=True, text=True)
    tail = r.stderr.split("Summary:")[-1]
    for line in tail.splitlines():
        if line.strip().startswith("I:"):
            return float(line.split()[1])
    raise RuntimeError("no loudness in ffmpeg output")


def band_db(x: np.ndarray, lo: float, hi: float) -> float:
    spec = np.abs(np.fft.rfft(x)) ** 2
    f = np.fft.rfftfreq(len(x), 1 / SR)
    p = spec[(f >= lo) & (f < hi)].sum() / (len(x) ** 2) * 2
    return 10 * np.log10(p + 1e-15)


def report() -> None:
    total = 0
    print(f"{'name':12} {'dur':>5} {'LUFS':>6} {'peak':>6} {'quiet%':>6} {'<250':>6} {'250-4k':>7} {'>4k':>6}  kB")
    for f in sorted(OUT.glob("*.mp3")):
        x = decode(f)
        dur = len(x) / SR
        win = SR // 2
        w = np.array([np.sqrt(np.mean(x[i:i + win] ** 2) + 1e-12) for i in range(0, len(x) - win, win)])
        quiet = 100 * np.mean(20 * np.log10(w) < -60)
        peak = 20 * np.log10(np.max(np.abs(x)) + 1e-12)
        kb = f.stat().st_size / 1024
        total += kb
        print(f"{f.stem:12} {dur:5.1f} {measure_lufs(f):6.1f} {peak:6.1f} {quiet:6.1f} {band_db(x, 0, 250):6.1f} {band_db(x, 250, 4000):7.1f} {band_db(x, 4000, 22050):6.1f} {kb:4.0f}")
    print(f"total {total:.0f} kB")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("step", choices=["fetch", "process", "report"])
    ap.add_argument("--raw", type=Path, default=Path("/tmp/versta-sound-raw"))
    a = ap.parse_args()
    if a.step == "fetch":
        fetch(a.raw)
    elif a.step == "process":
        process(a.raw)
    else:
        report()


if __name__ == "__main__":
    sys.exit(main())
