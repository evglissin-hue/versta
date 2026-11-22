#!/usr/bin/env python3
"""Remake the synthesised Versta sounds: write the sfx-skill project, render it, master each file to Versta's targets.

    python3 tools/sound/sfx/make.py --skill PATH/TO/sfx-skill/skills/sound-effects [--render DIR] [--only ID ...]

Steps: design.py writes project.json; sfx-skill's `sfx.py render` makes 48 kHz masters in --render (outside the repo by
default); then each master is high-passed, trimmed (effects), levelled and limited, and encoded to mono 64 kbps mp3:
effects to public/sounds/fx/<name>.mp3 at about -27 LUFS with the peak under -3 dBFS, loops to public/sounds/<name>.mp3
at about -26 LUFS. It prints each file's length, which goes into src/audio/catalogue.json for an effect. Afterwards run
`python3 tools/sound/build_sounds.py check`.
"""
from __future__ import annotations

import argparse
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(HERE.parent))
from build_sounds import KIND, decode, measure_lufs, SR  # noqa: E402

import numpy as np  # noqa: E402

# sfx-skill id -> (kind, Versta name)
OUTPUTS = {
    "sail_flap": ("fx", "sail-flap"), "tankards": ("fx", "tankards"), "oars": ("fx", "oars"),
    "distant_cannon": ("fx", "distant-cannon"), "parrots": ("fx", "parrots"), "big_bell": ("fx", "big-bell"),
    "crates": ("fx", "crates"), "waders": ("fx", "waders"), "water_flow": ("fx", "water-flow"),
    "rigging": ("loop", "rigging"), "cobbles": ("loop", "cobbles"), "tunnel": ("loop", "tunnel"),
    "waders_loop": ("loop", "waders"), "dockyard": ("loop", "dockyard"),
}


def ff(*args: str) -> None:
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)


def master_of(render: Path, sid: str) -> Path:
    found = sorted((render / "master").rglob(f"{sid}*.wav"))
    exact = [p for p in found if p.stem in (sid, f"{sid}_1", f"{sid}_01")]
    if not (exact or found):
        raise SystemExit(f"no master for {sid} in {render}")
    return (exact or found)[0]


def master(src: Path, kind: str, dst: Path) -> tuple[float, float, float]:
    lim = KIND[kind]
    dst.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        a = Path(tmp) / "a.wav"
        filt = ["highpass=f=60:poles=2"]
        if kind == "fx":
            filt.append("silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.02")
        ff("-i", str(src), "-ac", "1", "-ar", str(SR), "-af", ",".join(filt), str(a))
        if kind == "fx":   # short fades, after the trim
            n = len(decode(a)) / SR
            b = Path(tmp) / "b.wav"
            fo = min(0.4, n * 0.15)
            ff("-i", str(a), "-af", f"afade=t=in:d=0.005,afade=t=out:st={n - fo:.3f}:d={fo:.3f}", str(b))
            a = b
        gain = lim["lufs"] - measure_lufs(a)
        ceiling = 10 ** ((lim["peak"] - 0.7) / 20)
        for _ in range(3):   # the limiter takes some loudness off a peaky sound: correct the gain and go again
            ff("-i", str(a), "-af", f"volume={gain:.2f}dB,alimiter=limit={ceiling:.3f}:attack=1:release=80:level=disabled",
               "-ac", "1", "-ar", str(SR), "-b:a", f"{lim['kbps']}k", str(dst))
            off = lim["lufs"] - measure_lufs(dst)
            if abs(off) < 0.4:
                break
            gain += off
    x = decode(dst)
    return len(x) / SR, measure_lufs(dst), 20 * np.log10(np.max(np.abs(x)) + 1e-12)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skill", type=Path, required=True, help="the sfx-skill folder skills/sound-effects")
    ap.add_argument("--render", type=Path, default=Path(tempfile.gettempdir()) / "versta-sfx-render")
    ap.add_argument("--only", nargs="*", help="sfx-skill ids to make (default all)")
    ap.add_argument("--no-render", action="store_true", help="master the existing render again")
    a = ap.parse_args()
    ids = a.only or list(OUTPUTS)
    if not a.no_render:
        subprocess.run([sys.executable, str(HERE / "design.py"), "--skill", str(a.skill)], check=True)
        cmd = [sys.executable, str(a.skill / "scripts" / "sfx.py"), "render", str(HERE / "project.json"), "--output", str(a.render), "--no-page"]
        for sid in a.only or []:
            cmd += ["--sound", sid]
        subprocess.run(cmd, check=True)
    print(f"{'file':24} {'dur':>5} {'LUFS':>6} {'peak':>6}")
    for sid in ids:
        kind, name = OUTPUTS[sid]
        dst = ROOT / "public" / "sounds" / ("fx" if kind == "fx" else "") / f"{name}.mp3"
        dur, lufs, peak = master(master_of(a.render, sid), kind, dst)
        print(f"{dst.relative_to(ROOT / 'public' / 'sounds').as_posix():24} {dur:5.1f} {lufs:6.1f} {peak:6.1f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
