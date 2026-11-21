#!/usr/bin/env python3
"""Fetch, process, check and credit the recorded sounds in public/sounds/.

    python3 tools/sound/build_sounds.py fetch      # download the sources from Wikimedia Commons into --raw
    python3 tools/sound/build_sounds.py process    # cut, filter, normalise, encode; writes src/audio/credits-sounds.json
    python3 tools/sound/build_sounds.py report     # duration, loudness, peak, silence, band levels of every file
    python3 tools/sound/build_sounds.py check      # table of every file against its limits; exit 1 when one breaks
    python3 tools/sound/build_sounds.py credits    # write docs/sound-credits.md from the credits json files

Every source is CC0, public domain or CC BY (checked in the Commons file metadata when fetching). Commons rate limits
hard: API calls are 2 s apart, downloads 5 s apart and a 429 is retried after the pause the server asks for.

sources.json: a list of { name, file (Commons title without File:), kind (loop, fx or signal), start, length (seconds),
highpass, lowpass (Hz), gain (extra dB after normalising) }. Outputs: public/sounds/<name>.mp3 (loop),
public/sounds/fx/<name>.mp3 (fx), public/sounds/signals/<name>.mp3 (signal). Without `start`, a loop uses its steadiest
stretch.

Loops: mono, 64 kbps, about -26 LUFS, high-pass 60 Hz. Effects: mono, peak under -3 dBFS, about -27 LUFS over the
sounding part, short fades, leading silence trimmed. Signals: mono, peak under -6 dBFS, about -24 LUFS.
The app joins the end of each loop to its start with a short crossfade when it decodes the file (src/audio/loops.ts).

Needs ffmpeg, ffprobe and numpy. Run with `python3 -I` if the raw folder is untrusted.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np

UA = "Versta/0.3 (sound library build)"
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public" / "sounds"
CREDITS_SOUNDS = ROOT / "src" / "audio" / "credits-sounds.json"
CREDITS_MUSIC = ROOT / "src" / "audio" / "credits-music.json"
CATALOGUE = ROOT / "src" / "audio" / "catalogue.json"
SR = 44100
LICENCES_OK = re.compile(r"^(cc0|public domain|pd\b|cc[ -]by[ -]\d)", re.I)
LICENCES_BAD = re.compile(r"(\bsa\b|-sa\b|\bnc\b|-nc\b|\bnd\b|-nd\b|gfdl|gnu)", re.I)

# Limits per kind: target LUFS, loudness tolerance (LU), peak ceiling (dBFS), length range (s), bitrate (kbps).
KIND = {
    "loop": {"lufs": -26.0, "tol": 1.5, "peak": -1.0, "len": (15.0, 95.0), "kbps": 64},
    "fx": {"lufs": -27.0, "tol": 1.5, "peak": -3.0, "len": (0.5, 12.0), "kbps": 64},
    "signal": {"lufs": -24.0, "tol": 1.5, "peak": -6.0, "len": (2.5, 3.5), "kbps": 64},
}

SOURCES: list[dict] = json.loads(Path(__file__).with_name("sources.json").read_text())

_last_api = 0.0


def api(params: dict) -> dict:
    global _last_api
    url = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode({**params, "format": "json"})
    for _ in range(10):
        wait = 2.0 - (time.time() - _last_api)
        if wait > 0:
            time.sleep(wait)
        _last_api = time.time()
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


def out_path(s: dict) -> Path:
    kind = s.get("kind", "loop")
    return OUT / {"loop": "", "fx": "fx", "signal": "signals"}[kind] / f"{s['name']}.mp3"


def rel_path(s: dict) -> str:
    return "sounds/" + out_path(s).relative_to(OUT).as_posix()


def plain(html: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", html)).replace("&amp;", "&").replace("&#039;", "'").strip()


def fetch(raw: Path) -> None:
    raw.mkdir(parents=True, exist_ok=True)
    titles = sorted({s["file"] for s in SOURCES})
    meta: dict[str, dict] = {}
    for i in range(0, len(titles), 20):
        chunk = titles[i:i + 20]
        info = api({
            "action": "query", "titles": "|".join("File:" + t for t in chunk), "prop": "imageinfo",
            "iiprop": "url|extmetadata", "iiextmetadatafilter": "LicenseShortName|Artist|ObjectName",
        })
        for page in info["query"]["pages"].values():
            title = page["title"][5:]
            ii = (page.get("imageinfo") or [None])[0]
            if not ii:
                print(f"MISSING {title}")
                continue
            em = ii["extmetadata"]
            lic = plain(em["LicenseShortName"]["value"])
            if not LICENCES_OK.match(lic) or LICENCES_BAD.search(lic):
                print(f"SKIP {title}: licence is {lic}")
                continue
            meta[title] = {
                "licence": lic, "author": plain(em.get("Artist", {}).get("value", "unknown")),
                "source": "https://commons.wikimedia.org/wiki/File:" + title.replace(" ", "_"), "url": ii["url"].split("?")[0],
            }
    meta_file = raw / "meta.json"
    if meta_file.exists():
        meta = {**json.loads(meta_file.read_text()), **meta}
    meta_file.write_text(json.dumps(meta, indent=1, ensure_ascii=False))
    hdr = raw / "_headers.txt"
    for title, m in meta.items():
        dest = raw_path(raw, title)
        if dest.exists() and dest.stat().st_size > 20_000:
            continue
        for _ in range(6):
            r = subprocess.run(["curl", "-sS", "-A", UA, "-D", str(hdr), "-o", str(dest), "-w", "%{http_code}", m["url"]], capture_output=True, text=True)
            if r.stdout == "200":
                break
            ra = re.search(r"retry-after:\s*(\d+)", hdr.read_text(), re.I) if hdr.exists() else None
            print(f"{title}: {r.stdout}, waiting {ra.group(1) if ra else 60} s", flush=True)
            time.sleep(int(ra.group(1)) + 5 if ra else 65)
        if dest.exists() and dest.stat().st_size <= 20_000:
            dest.unlink()
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


def loudest(x: np.ndarray, length: float) -> float:
    """Start (seconds) of the loudest stretch of `length` seconds, a little before its first strong moment, so an effect begins at its onset."""
    n = int(length * SR)
    if len(x) <= n:
        return 0.0
    step = SR // 10
    e = np.array([np.mean(x[i:i + step] ** 2) for i in range(0, len(x) - step, step)])
    k = max(int(length * 10), 1)
    csum = np.concatenate([[0.0], np.cumsum(e)])
    best = int(np.argmax(csum[k:] - csum[:-k]))
    first = best
    while first < best + k and e[first] < e[best:best + k].max() * 0.05:
        first += 1
    return max(first - 1, 0) / 10


def measure_lufs(path: Path) -> float:
    r = subprocess.run(["ffmpeg", "-nostats", "-i", str(path), "-af", "ebur128=peak=true", "-f", "null", "-"], capture_output=True, text=True)
    tail = r.stderr.split("Summary:")[-1]
    for line in tail.splitlines():
        if line.strip().startswith("I:"):
            return float(line.split()[1])
    raise RuntimeError("no loudness in ffmpeg output")


def process(raw: Path) -> None:
    for kind in ("fx", "signals"):
        (OUT / kind).mkdir(parents=True, exist_ok=True)
    meta = json.loads((raw / "meta.json").read_text()) if (raw / "meta.json").exists() else {}
    old = {e["file"]: e for e in json.loads(CREDITS_SOUNDS.read_text())} if CREDITS_SOUNDS.exists() else {}
    for s in SOURCES:
        kind = s.get("kind", "loop")
        lim = KIND[kind]
        src = raw_path(raw, s["file"])
        if not src.exists():
            print(f"missing {src}")
            continue
        x = decode(src)
        length = min(float(s.get("length", 40)), len(x) / SR)
        start = s.get("start")
        if start is None:
            start = steadiest(x, length) if kind == "loop" else loudest(x, length)
        dst = out_path(s)
        dst.parent.mkdir(parents=True, exist_ok=True)
        filt = [f"highpass=f={s.get('highpass', 60)}:poles=2"]
        if "lowpass" in s:
            filt.append(f"lowpass=f={s['lowpass']}:poles=2")
        if kind != "loop":
            # trim leading silence, then fade in and out
            filt.append("silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.05")
            fo = min(0.4, length * 0.15)
            filt.append(f"afade=t=in:d=0.03,afade=t=out:st={max(length - fo, 0.1):.2f}:d={fo:.2f}")
        tmp = OUT / f"_{s['name']}.wav"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{start:.2f}", "-t", f"{length:.2f}", "-i", str(src), "-ac", "1", "-ar", str(SR), "-af", ",".join(filt), str(tmp)], check=True)
        lufs = measure_lufs(tmp)
        gain = lim["lufs"] - lufs + float(s.get("gain", 0))
        ceiling = 10 ** ((lim["peak"] - 0.5) / 20)
        post = f"volume={gain:.2f}dB,alimiter=limit={ceiling:.3f}:attack=2:release=60:level=disabled"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(tmp), "-af", post, "-ac", "1", "-b:a", f"{lim['kbps']}k", str(dst)], check=True)
        tmp.unlink()
        print(f"{rel_path(s)}: {s['file']} start {start:.1f}s length {length:.1f}s gain {gain:+.1f} dB")
        m = meta.get(s["file"])
        if m:
            cut = f"{length:.0f} s from {start:.0f} s" if start else f"{length:.0f} s from the start"
            extra = [f"high-pass {s['highpass']} Hz"] if "highpass" in s else []
            if "lowpass" in s:
                extra.append(f"low-pass {s['lowpass']} Hz")
            old[rel_path(s)] = {
                "file": rel_path(s), "title": s["file"], "author": m["author"], "licence": m["licence"], "source": m["source"],
                "cut": ", ".join([cut] + extra),
            }
    if old:
        CREDITS_SOUNDS.write_text(json.dumps(sorted(old.values(), key=lambda e: e["file"]), indent=1, ensure_ascii=False) + "\n")


def band_db(x: np.ndarray, lo: float, hi: float) -> float:
    spec = np.abs(np.fft.rfft(x)) ** 2
    f = np.fft.rfftfreq(len(x), 1 / SR)
    p = spec[(f >= lo) & (f < hi)].sum() / (len(x) ** 2) * 2
    return 10 * np.log10(p + 1e-15)


def sound_files() -> list[Path]:
    return sorted(p for p in OUT.rglob("*.mp3") if "music" not in p.relative_to(OUT).parts and p.name[0] != "_")


def kind_of(f: Path) -> str:
    rel = f.relative_to(OUT).parts
    return {"fx": "fx", "signals": "signal"}.get(rel[0], "loop") if len(rel) > 1 else "loop"


def report() -> None:
    total = 0
    print(f"{'name':22} {'dur':>5} {'LUFS':>6} {'peak':>6} {'quiet%':>6} {'<250':>6} {'250-4k':>7} {'>4k':>6}  kB")
    for f in sound_files():
        x = decode(f)
        win = SR // 2
        w = np.array([np.sqrt(np.mean(x[i:i + win] ** 2) + 1e-12) for i in range(0, max(len(x) - win, 1), win)])
        quiet = 100 * np.mean(20 * np.log10(w) < -60)
        peak = 20 * np.log10(np.max(np.abs(x)) + 1e-12)
        kb = f.stat().st_size / 1024
        total += kb
        print(f"{f.relative_to(OUT).as_posix()[:-4]:22} {len(x) / SR:5.1f} {measure_lufs(f):6.1f} {peak:6.1f} {quiet:6.1f} {band_db(x, 0, 250):6.1f} {band_db(x, 250, 4000):7.1f} {band_db(x, 4000, 22050):6.1f} {kb:4.0f}")
    print(f"total {total:.0f} kB")


def probe(f: Path) -> dict:
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=channels,bit_rate,sample_rate", "-of", "json", str(f)], capture_output=True, text=True, check=True)
    return json.loads(r.stdout)["streams"][0]


def check() -> int:
    cat = json.loads(CATALOGUE.read_text())
    bad = 0
    total = 0
    print(f"{'file':26} {'kind':6} {'dur':>5} {'LUFS':>6} {'target':>6} {'peak':>6} {'ch':>2} {'kbps':>4}  result")
    for f in sound_files():
        kind = kind_of(f)
        lim = KIND[kind]
        name = f.stem
        x = decode(f)
        dur = len(x) / SR
        lufs = measure_lufs(f)
        peak = 20 * np.log10(np.max(np.abs(x)) + 1e-12)
        pr = probe(f)
        kbps = int(pr.get("bit_rate", 0)) / 1000
        lo, hi = lim["len"]
        if kind == "fx" and name in cat["effects"]:
            sec = float(cat["effects"][name]["seconds"])
            lo, hi = sec * 0.5, sec * 1.5
        why = []
        if abs(lufs - lim["lufs"]) > lim["tol"]:
            why.append("loudness")
        if peak > lim["peak"]:
            why.append("peak")
        if not lo <= dur <= hi:
            why.append(f"length {lo:.1f} to {hi:.1f}")
        if int(pr["channels"]) != 1:
            why.append("not mono")
        if abs(kbps - lim["kbps"]) > 12:
            why.append("bitrate")
        if kind == "fx":
            if name not in cat["effects"]:
                why.append("not in catalogue")
            else:
                if abs(float(cat["effects"][name]["seconds"]) - round(dur, 1)) > 0.051:
                    why.append("catalogue seconds")
            head = np.abs(x[: int(0.2 * SR)])
            if head.size and np.max(head) < 10 ** (-60 / 20):
                why.append("silent start")
        if kind == "signal" and name in cat["signals"] and abs(float(cat["signals"][name]["seconds"]) - round(dur, 1)) > 0.051:
            why.append("catalogue seconds")
        total += f.stat().st_size
        bad += bool(why)
        print(f"{f.relative_to(OUT).as_posix()[:-4]:26} {kind:6} {dur:5.1f} {lufs:6.1f} {lim['lufs']:6.1f} {peak:6.1f} {pr['channels']:>2} {kbps:4.0f}  {'ok' if not why else 'FAIL ' + ', '.join(why)}")
    print(f"total {total / 1e6:.2f} MB (excluding music), {bad} failing")
    absent = [f"fx/{n}" for n in cat["effects"] if not (OUT / "fx" / f"{n}.mp3").exists()] + [f"signals/{n}" for n in ("aside",) if not (OUT / "signals" / f"{n}.mp3").exists()]
    if absent:
        print(f"not present yet ({len(absent)}): " + ", ".join(absent))
    return 1 if bad else 0


def credits() -> None:
    entries: list[dict] = []
    for p in (CREDITS_SOUNDS, CREDITS_MUSIC):
        if p.exists():
            entries += json.loads(p.read_text())
    sounds = [e for e in entries if not e["file"].startswith("sounds/music/")]
    music = [e for e in entries if e["file"].startswith("sounds/music/")]
    header = """# Sound credits

Every recorded sound in `public/sounds/` comes from Wikimedia Commons or a free soundfont. Licences are CC0, public
domain or CC BY (attribution given below and in the app). Nothing under CC BY-SA, NC, ND or GFDL is used. Licence
strings and authors are as Commons showed them when the files were fetched.

`tools/sound/build_sounds.py` cuts each file, mixes it to mono, high-passes it (60 Hz unless noted), normalises it and
encodes it as mp3 (loops about -26 LUFS at 64 kbps, effects about -27 LUFS, the ship's bell about -24 LUFS). The list of
sources is `tools/sound/sources.json`; this page is written by `python3 tools/sound/build_sounds.py credits` from
`src/audio/credits-sounds.json` and `src/audio/credits-music.json`. The app joins the end of each loop to its start
with a 1.5 s crossfade when it decodes the file.
"""

    def table(rows: list[dict]) -> str:
        lines = ["| File | Source page on Commons | Author | Licence | Cut |", "| --- | --- | --- | --- | --- |"]
        for e in rows:
            a = e["author"].replace("|", "/")
            lines.append(f"| {e['file'].removeprefix('sounds/')} | [{e['title'].replace('[', '(').replace(']', ')')}]({e['source']}) | {a} | {e['licence']} | {e['cut']} |")
        return "\n".join(lines)

    groups = [("Loops", lambda f: "/" not in f.removeprefix("sounds/")), ("Effects", lambda f: f.startswith("sounds/fx/")), ("Signals", lambda f: f.startswith("sounds/signals/"))]
    out = [header]
    for title, test in groups:
        rows = [e for e in sounds if test(e["file"])]
        if rows:
            out.append(f"\n## {title}\n\n{table(rows)}\n")
    if music:
        out.append(f"\n## Music\n\n{table(music)}\n")
    todo = [s for s in SOURCES if not out_path(s).exists()]
    out.append("""
## Still generated

The stand-in layers in `src/audio/soundscapes.ts` (`gen`) play in place of a recording that fails to load, and
wherever no recording has been fetched yet (below).
""")
    if todo:
        out.append("\n### Chosen on Commons, not fetched yet\n\nThese are in `tools/sound/sources.json` with licences read from their Commons pages. "
                   "`python3 tools/sound/build_sounds.py fetch` downloads them; Wikimedia answered every download request with 429 "
                   "(retry-after 600) while this was prepared.\n\n")
        out.append("\n".join(f"- `{rel_path(s).removeprefix('sounds/')}`: {s['file']}" for s in todo) + "\n")
    cat = json.loads(CATALOGUE.read_text())
    nofile = [n for n in cat["effects"] if not any(s["kind"] == "fx" and s["name"] == n for s in SOURCES)]
    if nofile:
        out.append("\nNo candidate under CC0, public domain or CC BY was found for these effects, and they stay unrecorded: "
                   + ", ".join(f"`{n}`" for n in nofile) + ".\n")
    (ROOT / "docs" / "sound-credits.md").write_text("".join(out))
    print("wrote docs/sound-credits.md")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("step", choices=["fetch", "process", "report", "check", "credits"])
    ap.add_argument("--raw", type=Path, default=Path("/tmp/versta-sound-raw"))
    a = ap.parse_args()
    if a.step == "fetch":
        fetch(a.raw)
    elif a.step == "process":
        process(a.raw)
    elif a.step == "report":
        report()
    elif a.step == "check":
        return check()
    else:
        credits()
    return 0


if __name__ == "__main__":
    sys.exit(main())
