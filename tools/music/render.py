#!/usr/bin/env python3
"""Versta music: composes nothing, renders what tools/music/themes/*.py and signals.py write down.

Setup (Debian/Ubuntu), nothing here is committed except the notes and the rendered mp3 files:

    apt-get install -y fluidsynth fluid-soundfont-gm ffmpeg   (libfluidsynth is called directly, see fluid())
    pip install numpy scipy pyloudnorm

Soundfont: FluidR3_GM by Frank Wen (MIT licence), /usr/share/sounds/sf2/FluidR3_GM.sf2. Never commit it.

Usage:

    python3 tools/music/render.py                 render all six themes and the three signals
    python3 tools/music/render.py noir arrive     render some of them
    python3 tools/music/render.py check           measure the shipped mp3 files, exit 1 on a broken limit
    python3 tools/music/render.py parts noir      level of each part on its own against the mix (for balancing)

Output: public/sounds/music/<theme>.mp3 and public/sounds/signals/<name>.mp3. Same notes, same files.

The loop. A theme is one loop of L seconds. The MIDI plays the theme three times back to back, the second cycle plus
the first 1.5 s of the third is kept. So the reverb and release tails of the end already sit over the start, exactly
as the app joins them (linear crossfade of the last 1.5 s over the first 1.5 s). The file is L + 1.5 s.

Theme files (tools/music/themes/<name>.py) define THEME, a dict:

    name, label, bpm, beats (per bar), bars, transpose (semitones for the whole theme, default 0),
    chords   {name: "C3+E3+G3"}  named voicings, used as {name} inside notes
    macros   {name: "one bar of notes, with {0} {1} as arguments"}
    parts    [ {name, prog, ch, pan, vol, rev, vel (lo, hi), bars, strum, shift, trem, swell} ]
    reverb   optional (room, damp, level) for this theme

A part's "bars" is one string, bars separated by "|". Each bar is one of:

    -                       a rest
    @macro(arg,arg)         a macro, its text with {0} {1} filled in; args may be chord names
    @macro*3                the same bar, 3 times (also works on notes and rests: "-*4")
    beat:pitch:dur[:vel]    events separated by spaces

beat is 0-based in quarter notes (1.5 is the "and" of beat 2). pitch is C4 = middle C, with # or b, "C3+E3+G3"
for a chord, {name} for a named chord, or a plain MIDI number (drums). dur is in beats; a trailing t on the dur
(2t) plays it as a tremolo, repeated notes every "trem" beats (default 0.125). vel is 1 to 127; without it a
repeatable pseudo-random value inside the part's "vel" range is used. "strum" staggers the notes of a chord by
that many milliseconds, "shift" moves the whole part by semitones, "swell" is (period_bars, low, high), a slow
expression (CC11) wave, 0 to 127, that starts at its low point on bar 1. Drum parts use ch 9 and a bank 128
program (40 is the brush kit); drum pitch names: kick tap slap swirl hat pedal ride.

Timing and velocity get a tiny repeatable human wobble (seeded by theme and part), the same in every cycle.
"""
import importlib.util
import json
import math
import random
import subprocess
import sys
from pathlib import Path

import numpy as np
import pyloudnorm as pyln
from scipy import signal as sps

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
SF2 = "/usr/share/sounds/sf2/FluidR3_GM.sf2"
MUSIC_DIR = ROOT / "public" / "sounds" / "music"
SIGNAL_DIR = ROOT / "public" / "sounds" / "signals"
CATALOGUE = ROOT / "src" / "audio" / "catalogue.json"
CREDITS = ROOT / "src" / "audio" / "credits-music.json"
SR = 48000
TPB = 480
TAIL = 1.5
THEMES = ["noir", "river", "solemn", "russia", "bright", "voyage"]
SIGNALS = ["arrive", "close", "finish"]

# Limits for the check command.
MUSIC_LUFS = -28.0
MUSIC_LUFS_TOL = 1.5
MUSIC_PEAK = -3.0
MONO_DIFF = 3.0
MID_OVER_LOW = 3.0
SEAM_DB = -18.0  # seam error as dB below the loop's own level, measured on the mp3 (encoder noise included)
SIGNAL_TARGET = {"arrive": -24.0, "close": -26.0, "finish": -24.0}
SIGNAL_LUFS_TOL = 2.0
SIGNAL_PEAK = -6.0
MUSIC_BYTES = 5_000_000

NAMES = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
DRUMS = {"kick": 36, "tap": 38, "slap": 39, "swirl": 40, "hat": 42, "pedal": 44, "ride": 51}


def pitch(token):
    if token in DRUMS:
        return DRUMS[token]
    if token.lstrip("-").isdigit():
        return int(token)
    n = NAMES[token[0]]
    i = 1
    while token[i] in "#b":
        n += 1 if token[i] == "#" else -1
        i += 1
    return 12 * (int(token[i:]) + 1) + n


# ---------------------------------------------------------------- notation

def load_theme(name):
    spec = importlib.util.spec_from_file_location("theme_" + name, HERE / "themes" / (name + ".py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.THEME


def expand_bar(text, theme):
    """One bar token to a list of event strings."""
    text = text.strip()
    if text in ("", "-"):
        return []
    if text.startswith("@"):
        body = text[1:]
        args = []
        if "(" in body:
            body, rest = body.split("(", 1)
            args = [a.strip() for a in rest.rstrip(")").split(",")]
        args = [theme.get("chords", {}).get(a, a) for a in args]
        out = theme["macros"][body.strip()]
        for i, a in enumerate(args):
            out = out.replace("{%d}" % i, a)
        return expand_bar(out, theme) if out.strip().startswith("@") else out.split()
    chords = theme.get("chords", {})
    for k, v in chords.items():
        text = text.replace("{" + k + "}", v)
    return text.split()


def bars_of(part, theme):
    out = []
    for raw in part["bars"].split("|"):
        raw = raw.strip()
        n = 1
        if "*" in raw:
            raw, k = raw.rsplit("*", 1)
            n = int(k)
        out.extend([expand_bar(raw, theme)] * n)
    if len(out) != theme["bars"]:
        raise SystemExit("%s part %s has %d bars, theme says %d" % (theme["name"], part["name"], len(out), theme["bars"]))
    return out


def timing(theme):
    """Loop length in samples, a whole number of FluidSynth's 64-sample blocks (it starts every note on a block
    boundary), so every cycle quantises the same way. The tempo is off by under a millisecond in the whole loop."""
    return 64 * int(round(theme["bars"] * theme["beats"] * 60.0 / theme["bpm"] * SR / 64))


def cycle_ticks(theme):
    return int(theme["bars"] * theme["beats"] * TPB)


def part_events(theme, part):
    """Notes and controllers of one cycle: ([(on, off, note, vel)], [(tick, cc, value)])."""
    rng = random.Random("%s/%s" % (theme["name"], part["name"]))
    lo, hi = part.get("vel", (50, 70))
    shift = theme.get("transpose", 0) + part.get("shift", 0)
    is_drum = part["ch"] == 9
    jit = 3 if is_drum else 7
    notes = []
    for b, events in enumerate(bars_of(part, theme)):
        for ev in events:
            f = ev.split(":")
            beat = float(f[0])
            names = f[1].split("+")
            dur = f[2]
            vel = int(f[3]) if len(f) > 3 else None
            trem = dur.endswith("t")
            dur = float(dur.rstrip("t"))
            if beat + dur > theme["beats"] + 0.001:
                raise SystemExit("%s/%s bar %d: %s runs past the bar" % (theme["name"], part["name"], b + 1, ev))
            t0 = (b * theme["beats"] + beat) * TPB
            for k, nm in enumerate(names):
                v = vel if vel is not None else rng.randint(lo, hi)
                n = pitch(nm) + (0 if is_drum else shift)
                on = t0 + rng.randint(-jit, jit) + k * part.get("strum", 0) * 1e-3 * TPB * theme["bpm"] / 60.0
                if trem:
                    step = part.get("trem", 0.125) * TPB
                    m = max(1, int(round(dur * TPB / step)))
                    for j in range(m):
                        swell = 0.75 + 0.25 * math.sin(math.pi * (j + 0.5) / m)
                        vj = max(1, min(127, int(v * swell) + rng.randint(-4, 4)))
                        notes.append((int(on + j * step), int(on + (j + 0.9) * step), n, vj))
                else:
                    notes.append((int(on), int(on + dur * TPB - 0.03 * TPB), n, v))
    ccs = []
    if "swell" in part:
        period, a, c = part["swell"]
        total = theme["bars"] * theme["beats"]
        step = 0.25
        for i in range(int(total / step)):
            ph = (i * step) / (period * theme["beats"])
            val = a + (c - a) * 0.5 * (1 - math.cos(2 * math.pi * ph))
            ccs.append((int(i * step * TPB), 11, int(round(val))))
    return notes, ccs


def build_events(theme, cycles, only=None):
    """Sample-timed synth events for `cycles` back-to-back cycles, and the reverb settings."""
    L = timing(theme)
    cyc_ticks = cycle_ticks(theme)
    per_tick = L / cyc_ticks
    ev = []  # (sample, order, kind, channel, a, b)
    rev = theme.get("reverb", (0.8, 0.45, 0.55))
    for p in theme["parts"]:
        if only and p["name"] != only:
            continue
        ch = p["ch"]
        ev.append((0, 0, "prog", ch, p["prog"], 128 if ch == 9 else 0))
        for cc, v in [(7, p.get("vol", 100)), (10, int(round(64 + p.get("pan", 0) * 63))), (91, p.get("rev", 50)), (93, 0)]:
            ev.append((0, 1, "cc", ch, cc, v))
        if "swell" not in p:
            ev.append((0, 1, "cc", ch, 11, 127))
        notes, ccs = part_events(theme, p)
        for c in range(cycles):
            base = c * L
            for on, off, n, v in notes:
                s_on = max(0, base + int(round(on * per_tick)))
                s_off = max(s_on + 1, base + int(round(off * per_tick)))
                ev.append((s_on, 3, "on", ch, n, v))
                ev.append((s_off, 2, "off", ch, n, 0))
            for t, cc, val in ccs:
                ev.append((base + int(round(t * per_tick)), 1, "cc", ch, cc, val))
    ev.sort(key=lambda e: (e[0], e[1]))
    return ev, rev


# ---------------------------------------------------------------- audio

def fluid(events, total, rev=None, gain=0.7):
    """Render sample-timed events through libfluidsynth (the engine behind the fluidsynth command line).

    rev is None means a dry render (the themes add their own reverb, see room()); signals use FluidSynth's.
    The command line player places events on a 1 ms clock in blocks of 64 samples, which makes the second and
    third cycle of a loop differ by a fraction of a block and spoils the seam. Calling the library directly puts
    every event on its exact sample, so every cycle is the same to the bit (reverb tails aside)."""
    import ctypes as C
    lib = C.CDLL("libfluidsynth.so.3")
    for name, res, args in [
        ("new_fluid_settings", C.c_void_p, []),
        ("fluid_settings_setint", C.c_int, [C.c_void_p, C.c_char_p, C.c_int]),
        ("fluid_settings_setnum", C.c_int, [C.c_void_p, C.c_char_p, C.c_double]),
        ("new_fluid_synth", C.c_void_p, [C.c_void_p]),
        ("fluid_synth_sfload", C.c_int, [C.c_void_p, C.c_char_p, C.c_int]),
        ("fluid_synth_program_select", C.c_int, [C.c_void_p, C.c_int, C.c_int, C.c_int, C.c_int]),
        ("fluid_synth_cc", C.c_int, [C.c_void_p, C.c_int, C.c_int, C.c_int]),
        ("fluid_synth_noteon", C.c_int, [C.c_void_p, C.c_int, C.c_int, C.c_int]),
        ("fluid_synth_noteoff", C.c_int, [C.c_void_p, C.c_int, C.c_int]),
        ("fluid_synth_write_float", C.c_int, [C.c_void_p, C.c_int, C.c_void_p, C.c_int, C.c_int, C.c_void_p, C.c_int, C.c_int]),
        ("delete_fluid_synth", None, [C.c_void_p]),
        ("delete_fluid_settings", None, [C.c_void_p]),
    ]:
        f = getattr(lib, name)
        f.restype, f.argtypes = res, args
    st = lib.new_fluid_settings()
    lib.fluid_settings_setnum(st, b"synth.sample-rate", float(SR))
    lib.fluid_settings_setnum(st, b"synth.gain", gain)
    lib.fluid_settings_setint(st, b"synth.polyphony", 256)
    lib.fluid_settings_setint(st, b"synth.chorus.active", 0)
    lib.fluid_settings_setint(st, b"synth.reverb.active", 0 if rev is None else 1)
    if rev is not None:
        lib.fluid_settings_setnum(st, b"synth.reverb.room-size", rev[0])
        lib.fluid_settings_setnum(st, b"synth.reverb.damp", rev[1])
        lib.fluid_settings_setnum(st, b"synth.reverb.width", 0.9)
        lib.fluid_settings_setnum(st, b"synth.reverb.level", rev[2])
    lib.fluid_settings_setint(st, b"synth.threadsafe-api", 0)
    sy = lib.new_fluid_synth(st)
    sf = lib.fluid_synth_sfload(sy, SF2.encode(), 1)
    if sf < 0:
        raise SystemExit("cannot load " + SF2)
    out = np.zeros((total, 2), dtype=np.float32)
    ptr = out.ctypes.data
    pos = 0
    i = 0
    n = len(events)
    while pos < total:
        while i < n and events[i][0] <= pos:
            _, _, kind, ch, a, b = events[i]
            if kind == "prog":
                lib.fluid_synth_program_select(sy, ch, sf, b, a)
            elif kind == "cc":
                lib.fluid_synth_cc(sy, ch, a, b)
            elif kind == "on":
                lib.fluid_synth_noteon(sy, ch, a, b)
            else:
                lib.fluid_synth_noteoff(sy, ch, a)
            i += 1
        nxt = events[i][0] if i < n else total
        nxt = min(max(nxt, pos + 1), total)
        ln = nxt - pos
        lib.fluid_synth_write_float(sy, ln, ptr + pos * 8, 0, 2, ptr + pos * 8, 1, 2)
        pos = nxt
    lib.delete_fluid_synth(sy)
    lib.delete_fluid_settings(st)
    return out.astype(np.float64)


def biquad(kind, f0, gain_db, q):
    a_ = 10 ** (gain_db / 40)
    w = 2 * math.pi * f0 / SR
    al = math.sin(w) / (2 * q)
    cw = math.cos(w)
    if kind == "peak":
        b = [1 + al * a_, -2 * cw, 1 - al * a_]
        a = [1 + al / a_, -2 * cw, 1 - al / a_]
    elif kind == "hishelf":
        s = 2 * math.sqrt(a_) * al
        b = [a_ * ((a_ + 1) + (a_ - 1) * cw + s), -2 * a_ * ((a_ - 1) + (a_ + 1) * cw), a_ * ((a_ + 1) + (a_ - 1) * cw - s)]
        a = [(a_ + 1) - (a_ - 1) * cw + s, 2 * ((a_ - 1) - (a_ + 1) * cw), (a_ + 1) - (a_ - 1) * cw - s]
    elif kind == "loshelf":
        s = 2 * math.sqrt(a_) * al
        b = [a_ * ((a_ + 1) - (a_ - 1) * cw + s), 2 * a_ * ((a_ - 1) - (a_ + 1) * cw), a_ * ((a_ + 1) - (a_ - 1) * cw - s)]
        a = [(a_ + 1) + (a_ - 1) * cw + s, -2 * ((a_ - 1) + (a_ + 1) * cw), (a_ + 1) + (a_ - 1) * cw - s]
    else:
        raise ValueError(kind)
    return np.array(b) / a[0], np.array(a) / a[0]


def under_speech(x, theme=None):
    """Broad dip at 1 kHz, gentle cut above 6 kHz, rumble out below 35 Hz."""
    eq = (theme or {}).get("eq", {})
    sos = sps.butter(2, 35, "highpass", fs=SR, output="sos")
    x = sps.sosfilt(sos, x, axis=0)
    for kind, f0, g, q in [("peak", 1000, eq.get("dip", -5.0), 0.5), ("hishelf", 6000, -4.0, 0.7)] + \
            ([("loshelf", 200, eq["low"], 0.7)] if "low" in eq else []):
        b, a = biquad(kind, f0, g, q)
        x = sps.lfilter(b, a, x, axis=0)
    return x


def to_mp3(x, path, bitrate, channels):
    path.parent.mkdir(parents=True, exist_ok=True)
    pcm = np.clip(x, -1, 1).astype("<f4").tobytes()
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-f", "f32le", "-ar", str(SR), "-ac", str(channels), "-i", "-",
           "-c:a", "libmp3lame", "-b:a", bitrate, "-ar", str(SR), "-ac", str(channels), "-map_metadata", "-1",
           "-fflags", "+bitexact", "-flags:a", "+bitexact", str(path)]
    subprocess.run(cmd, input=pcm, check=True)


def read_mp3(path):
    r = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", str(path), "-f", "f32le", "-ar", str(SR), "-"],
                       capture_output=True, check=True)
    # channel count from the file itself
    info = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=channels",
                           "-of", "csv=p=0", str(path)], capture_output=True, check=True, text=True)
    ch = int(info.stdout.strip())
    return np.frombuffer(r.stdout, dtype="<f4").astype(np.float64).reshape(-1, ch)


def lufs(x):
    if x.shape[1] == 1:
        x = np.repeat(x, 2, axis=1)
    return pyln.Meter(SR).integrated_loudness(x)


def peak_db(x):
    return 20 * math.log10(max(np.abs(x).max(), 1e-9))


def band_db(x):
    mono = x.mean(axis=1)
    f, p = sps.welch(mono, SR, nperseg=16384)
    df = f[1] - f[0]
    def band(a, b):
        sel = (f >= a) & (f < b)
        return 10 * math.log10(max(p[sel].sum() * df, 1e-20))
    return band(60, 300), band(300, 3000), band(3000, 24000)


def mono_diff(x):
    m = x.mean(axis=1, keepdims=True)
    return lufs(np.repeat(m, 2, axis=1)) - lufs(x)


def seam_db(x, loop_len):
    n = int(TAIL * SR)
    start = x[:n]
    tail = x[loop_len:loop_len + n]
    r = math.sqrt(np.mean((tail - start) ** 2)) / max(math.sqrt(np.mean(x[:loop_len] ** 2)), 1e-9)
    return 20 * math.log10(max(r, 1e-9))


def room(theme, seed=1):
    """A synthetic stereo room: decaying noise, darker as it fades, a short pre-delay. Convolution is linear and
    time-invariant, so a tail that crosses the loop seam is exactly the tail the next cycle will have.
    Theme "reverb" is (rt60 seconds, how much shorter the highs ring, level)."""
    rt, damp, level = theme.get("reverb", (2.4, 0.45, 1.0))
    n = int(rt * 1.4 * SR)
    t = np.arange(n) / SR
    rng = np.random.RandomState(seed)
    irs = []
    sos = sps.butter(2, 3000, "lowpass", fs=SR, output="sos")
    for _ in range(2):
        w = rng.randn(n)
        lo = sps.sosfilt(sos, w)
        hi = w - lo
        ir = lo * np.exp(-6.9 * t / rt) + hi * np.exp(-6.9 * t / (rt * damp))
        ir[: int(0.015 * SR)] = 0
        ir[int(0.015 * SR):int(0.035 * SR)] *= np.linspace(0, 1, int(0.02 * SR))
        irs.append(ir / math.sqrt(np.sum(ir ** 2)))
    return irs, level


def render_theme_audio(theme, only=None):
    L = timing(theme)
    total = 3 * L
    dry = np.zeros((total, 2))
    wet = np.zeros((total, 2))
    for p in theme["parts"]:
        if only and p["name"] != only:
            continue
        ev, _ = build_events(theme, 3, p["name"])
        x = fluid(ev, total)
        dry += x
        wet += x * (p.get("rev", 50) / 127.0)
    irs, level = room(theme)
    bus = wet.mean(axis=1)
    tail = np.stack([sps.fftconvolve(bus, irs[0])[:total], sps.fftconvolve(bus, irs[1])[:total]], axis=1)
    x = under_speech(dry + tail * level, theme)
    seg = x[L:2 * L + int(TAIL * SR)]
    return seg, L


def render_theme(name):
    theme = load_theme(name)
    seg, L = render_theme_audio(theme)
    gain = 10 ** ((MUSIC_LUFS - lufs(seg[:L])) / 20)
    seg = seg * gain
    pk = peak_db(seg)
    if pk > MUSIC_PEAK - 0.5:
        seg = seg * 10 ** ((MUSIC_PEAK - 0.5 - pk) / 20)
    out = MUSIC_DIR / (name + ".mp3")
    to_mp3(seg, out, "96k", 2)
    print("%-7s %6.2f s  %s  %d KB" % (name, len(seg) / SR, out.relative_to(ROOT), out.stat().st_size // 1024))


def render_parts(name):
    theme = load_theme(name)
    full, L = render_theme_audio(theme)
    ref = lufs(full[:L])
    print("%s mix %.1f LUFS (before levelling)" % (name, ref))
    for p in theme["parts"]:
        seg, L = render_theme_audio(theme, p["name"])
        l = lufs(seg[:L]) if np.abs(seg).max() > 1e-6 else -99
        print("  %-10s %6.1f LU against the mix" % (p["name"], l - ref))


# ---------------------------------------------------------------- signals

def signal_events(spec):
    ev = []
    for p in spec["parts"]:
        ch = p["ch"]
        ev.append((0, 0, "prog", ch, p["prog"], 0))
        for cc, v in [(7, p.get("vol", 100)), (10, int(64 + p.get("pan", 0) * 63)), (91, p.get("rev", 50)), (93, 0)]:
            ev.append((0, 1, "cc", ch, cc, v))
        for t, names, d, v in p["notes"]:
            for nm in names.split("+"):
                on = int(round(t * SR))
                ev.append((on, 3, "on", ch, pitch(nm), v))
                ev.append((on + int(d * SR), 2, "off", ch, pitch(nm), 0))
    ev.sort(key=lambda e: (e[0], e[1]))
    return ev


def render_signal(name):
    spec = importlib.util.spec_from_file_location("signals", HERE / "signals.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    s = mod.SIGNALS[name]
    x = fluid(signal_events(s), int((s["length"] + 0.5) * SR), s.get("reverb", (0.6, 0.5, 0.45)))
    x = x.mean(axis=1, keepdims=True)
    # trim the lead-in to 5 ms before the first audible sample, and the tail to the wanted length
    a = np.abs(x[:, 0])
    first = int(np.argmax(a > a.max() * 10 ** (-50 / 20)))
    x = x[max(0, first - int(0.005 * SR)):]
    x = x[:int(s["length"] * SR)]
    fade = int(0.15 * SR)
    x[-fade:] *= np.linspace(1, 0, fade)[:, None]
    target = SIGNAL_TARGET[name]
    x = x * 10 ** ((target - lufs(x)) / 20)
    pk = peak_db(x)
    if pk > SIGNAL_PEAK - 0.5:
        x = x * 10 ** ((SIGNAL_PEAK - 0.5 - pk) / 20)
    out = SIGNAL_DIR / (name + ".mp3")
    to_mp3(x, out, "64k", 1)
    secs = round(len(x) / SR, 1)
    print("%-7s %6.2f s  %s  %d KB" % (name, len(x) / SR, out.relative_to(ROOT), out.stat().st_size // 1024))
    return secs


def write_catalogue(seconds):
    text = CATALOGUE.read_text()
    cat = json.loads(text)
    for k, v in seconds.items():
        cat["signals"][k]["seconds"] = v
    # keep the file's own layout: edit only the numbers in place
    import re
    for k, v in seconds.items():
        text = re.sub(r'("%s":\s*\{[^}]*"seconds":\s*)[0-9.]+' % k, lambda m: m.group(1) + str(v), text)
    CATALOGUE.write_text(text)


# ---------------------------------------------------------------- check

def check():
    bad = []
    total = 0
    print("%-7s %7s %7s %7s %7s %7s %7s %7s %7s %7s" % ("theme", "length", "LUFS", "peak", "mono", "low", "mid", "high", "mid-low", "seam"))
    for name in THEMES:
        path = MUSIC_DIR / (name + ".mp3")
        if not path.exists():
            bad.append("%s: file missing" % name)
            continue
        theme = load_theme(name)
        total += path.stat().st_size
        x = read_mp3(path)
        L = timing(theme)
        want = L / SR
        ln = len(x) / SR
        lu, pk, md = lufs(x[:L]), peak_db(x), mono_diff(x)
        lo, mi, hi = band_db(x[:L])
        sm = seam_db(x, L)
        print("%-7s %6.2fs %7.1f %7.1f %7.1f %7.1f %7.1f %7.1f %7.1f %7.1f" % (name, ln, lu, pk, md, lo, mi, hi, mi - lo, sm))
        if not (64.0 <= want <= 80.0):
            bad.append("%s: loop %.1f s outside 64 to 80 s" % (name, want))
        if abs(ln - (want + TAIL)) > 0.1:
            bad.append("%s: length %.2f, want %.2f" % (name, ln, want + TAIL))
        if x.shape[1] != 2:
            bad.append("%s: not stereo" % name)
        if abs(lu - MUSIC_LUFS) > MUSIC_LUFS_TOL:
            bad.append("%s: %.1f LUFS" % (name, lu))
        if pk > MUSIC_PEAK:
            bad.append("%s: peak %.1f dBFS" % (name, pk))
        if abs(md) > MONO_DIFF:
            bad.append("%s: mono sum differs by %.1f dB" % (name, md))
        if mi - lo > MID_OVER_LOW:
            bad.append("%s: middle band %.1f dB over the low band" % (name, mi - lo))
        if sm > SEAM_DB:
            bad.append("%s: loop seam error %.1f dB" % (name, sm))
        if not (54 <= theme["bpm"] <= 76):
            bad.append("%s: tempo %s outside 54 to 76" % (name, theme["bpm"]))
    cat = json.loads(CATALOGUE.read_text())["signals"]
    print()
    print("%-7s %7s %7s %7s %9s" % ("signal", "length", "LUFS", "peak", "lead (ms)"))
    for name in SIGNALS:
        path = SIGNAL_DIR / (name + ".mp3")
        if not path.exists():
            bad.append("%s: file missing" % name)
            continue
        x = read_mp3(path)
        ln = len(x) / SR
        lu, pk = lufs(x), peak_db(x)
        a = np.abs(x[:, 0])
        lead = float(np.argmax(a > 10 ** (-60 / 20)) / SR * 1000)
        print("%-7s %6.2fs %7.1f %7.1f %9.0f" % (name, ln, lu, pk, lead))
        if x.shape[1] != 1:
            bad.append("%s: not mono" % name)
        if abs(lu - SIGNAL_TARGET[name]) > SIGNAL_LUFS_TOL:
            bad.append("%s: %.1f LUFS" % (name, lu))
        if pk > SIGNAL_PEAK:
            bad.append("%s: peak %.1f dBFS" % (name, pk))
        if lead > 30:
            bad.append("%s: %.0f ms of silence at the start" % (name, lead))
        if abs(cat[name]["seconds"] - ln) > 0.1:
            bad.append("%s: catalogue says %s s, file is %.2f s" % (name, cat[name]["seconds"], ln))
    print("\nmusic folder: %d bytes" % total)
    if total > MUSIC_BYTES:
        bad.append("public/sounds/music is %d bytes, limit %d" % (total, MUSIC_BYTES))
    try:
        credited = {e["file"] for e in json.loads(CREDITS.read_text())}
    except Exception as e:  # noqa: BLE001
        credited = set()
        bad.append("credits-music.json unreadable: %s" % e)
    for name in THEMES:
        if "sounds/music/%s.mp3" % name not in credited:
            bad.append("no credit line for %s" % name)
    for name in SIGNALS:
        if "sounds/signals/%s.mp3" % name not in credited:
            bad.append("no credit line for %s" % name)
    if bad:
        print("\nBROKEN:")
        for b in bad:
            print("  " + b)
        return 1
    print("\nall limits hold")
    return 0


def write_public_credits():
    """public/sounds/credits.json: credits-sounds.json and credits-music.json merged."""
    entries = []
    for p in (CREDITS.with_name("credits-sounds.json"), CREDITS):
        if p.exists():
            entries += json.loads(p.read_text())
    out = ROOT / "public" / "sounds" / "credits.json"
    out.write_text(json.dumps(entries, indent=1, ensure_ascii=False) + "\n")
    print("wrote", out.relative_to(ROOT))


def main(argv):
    if argv and argv[0] == "check":
        return check()
    if argv and argv[0] == "parts":
        for n in argv[1:] or THEMES:
            render_parts(n)
        return 0
    want = argv or THEMES + SIGNALS
    secs = {}
    for n in want:
        if n in THEMES:
            render_theme(n)
        elif n in SIGNALS:
            secs[n] = render_signal(n)
        else:
            raise SystemExit("unknown name " + n)
    if secs:
        write_catalogue(secs)
        print("catalogue seconds:", secs)
    write_public_credits()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
