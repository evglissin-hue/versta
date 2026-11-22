#!/usr/bin/env python3
"""The sfx-skill project for the Versta sounds that have no recording: nine story effects and five soundscape loops.

Every sound is synthesis only (no recordings), so each is CC0, composed for Versta. This script writes
tools/sound/sfx/project.json with sfx-skill's own builders (scripts/sfxkit.py); make.py renders it and masters the
files. Event times are drawn from a fixed seed, so the project comes out the same every run.

    python3 tools/sound/sfx/design.py --skill PATH/TO/sfx-skill/skills/sound-effects
"""
from __future__ import annotations

import argparse
import random
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
LOOP_S = 30.0


def build(kit) -> list[dict]:
    """The sounds. `kit` is sfx-skill's sfxkit module."""
    k = kit
    rnd = random.Random(1911)

    def r(a: float, b: float) -> float:
        return round(rnd.uniform(a, b), 3)

    def filt(layer: dict, f: dict) -> dict:
        layer["filter"] = f
        return layer

    def creak(t: float, f0: float, length: float, gain: float, centre: float = 900) -> dict:
        """Rope or timber under strain: a saw gliding up and back through a narrow band."""
        return k.tone(t, length, [[0, f0, "exp"], [length * 0.45, f0 * 1.45, "exp"], [length, f0 * 0.9]], wave="saw",
                      env=[[0, 0, "cos"], [length * 0.2, 1, "lin"], [length * 0.6, 0.5, "cos"], [length, 0]], gain=gain,
                      filt=k.bp(centre, 6))

    def knock(t: float, hz: float, gain: float, length: float = 0.3, t_d: float = 4.0) -> dict:
        """Wood struck: a wooden block, a thole pin, a crate side."""
        return k.modal(t, length, hz, t_d, modes=6, hardness=0.5, gain=gain, detune=8)

    def ring(t: float, hz: float, t_d: float, length: float, gain: float, ratios=None, hardness=0.8, cut=None) -> dict:
        layer = k.modal(t, length, hz, t_d, hardness=hardness, gain=gain, detune=6, ratios=ratios)
        return filt(layer, k.lp(cut)) if cut else layer

    def call(t: float, pts: list, length: float, gain: float, trill=None, wave="sine") -> dict:
        """A bird's whistle: a sine on a pitch curve, with a bubbling flutter when `trill` is given."""
        env = [[0, 0, "cos"], [min(0.05, length * 0.2), 1, "lin"], [length * 0.75, 0.7, "cos"], [length, 0]]
        return k.tone(t, length, pts, wave=wave, env=env, gain=gain,
                      tremolo={"rate_hz": trill, "depth": 0.75} if trill else None)

    sounds: list[dict] = []

    # ---- story effects (one-shots) -------------------------------------------------------------------------------
    sounds.append(k.sound("sail_flap", "foley", "Sails filling: wind, slack canvas fluttering, a full whump as the sail takes the "
                          "wind, then rigging creaking under the load.", [
        k.wind(0, 4.3, band_hz=260, turbulence=0.35, gust_hz=0.8, env=[[0, 0, "cos"], [0.4, 1], [3.6, 1, "cos"], [4.3, 0]], gain=-7),
        filt({**k.noise(0.1, 1.6, "pink", env=[[0, 0, "cos"], [1.2, 1, "lin"], [1.6, 0.3]], gain=-1),
              "tremolo": {"rate_hz": 11, "depth": 0.85}}, k.bp(420, 0.9)),
        k.noise(1.55, 0.45, "brown", env=k.decay(0.45, 0.01), filt=k.lp(320), gain=1),
        k.thump(1.56, 95, 48, 0.35, gain=-5),
        k.noise(1.56, 0.12, "pink", env=k.decay(0.12, 0.003), filt=k.bp(950, 1.2), gain=-5),
        filt({**k.noise(1.9, 1.9, "pink", env=[[0, 0, "cos"], [0.3, 1], [1.4, 0.6, "cos"], [1.9, 0]], gain=-10),
              "tremolo": {"rate_hz": 17, "depth": 0.5}}, k.bp(640, 1.0)),
        knock(2.0, 330, -13),
        creak(2.3, 95, 0.8, -11),
        creak(3.2, 120, 0.7, -13, centre=1100),
    ], chain={"eq": {"low_cut_hz": 60}, "room": {"size": 1.0, "decay": 0.5, "mix": 0.08}},))

    pewter = [1, 1.59, 2.91, 4.33]
    glass = [1, 2.32, 4.25, 6.63]
    sounds.append(k.sound("tankards", "foley", "Tankards and glasses: a pewter tankard set down on a wooden table, glasses "
                          "touching, two tankards knocked together, a last one set down.", [
        knock(0.0, 165, 0, t_d=5), k.thump(0.0, 120, 70, 0.12, gain=-9), ring(0.0, 880, 50, 0.6, -11, pewter, 0.6),
        ring(0.62, 2450, 120, 1.2, -6, glass, 0.9), ring(0.645, 2790, 120, 1.0, -9, glass, 0.9),
        ring(1.3, 690, 40, 0.8, -4, pewter, 0.85), k.crack(1.3, gain=-14, cutoff=2000),
        ring(1.95, 3120, 120, 0.9, -11, glass, 0.9),
        knock(2.35, 150, -3, t_d=5), k.thump(2.35, 115, 65, 0.12, gain=-10), ring(2.35, 820, 50, 0.5, -13, pewter, 0.6),
    ], chain={"eq": {"low_cut_hz": 70}, "room": {"size": 0.6, "decay": 0.5, "mix": 0.15}},))

    def stroke(t: float) -> list[dict]:
        drops = lambda start, length, rate, slope, gain, env: k._layer(  # noqa: E731
            {"type": "drops", "rate": rate, "r_min_mm": 0.5, "r_max_mm": 4, "size_slope": slope}, start, length, env, gain)
        return [
            knock(t, 260, -11, t_d=4), creak(t + 0.02, 140, 0.35, -15, centre=1300),
            drops(t + 0.05, 0.5, 5000, 2, -2, k.decay(0.5, 0.01)),
            k.noise(t + 0.05, 0.18, "pink", env=k.decay(0.18, 0.004), filt=k.bp(1800, 0.8), gain=-6),
            drops(t + 0.25, 0.9, 1500, 1, -7, [[0, 0, "cos"], [0.3, 1], [0.9, 0]]),
            k.noise(t + 0.25, 0.8, "brown", env=[[0, 0, "cos"], [0.3, 1], [0.8, 0]], filt=k.lp(600), gain=-10),
            drops(t + 1.1, 0.7, 250, 3, -15, k.decay(0.7, 0.05)),
        ]
    sounds.append(k.sound("oars", "foley", "Two strokes of a pair of oars: the thole pins knock, the blades bite, the water "
                          "swirls past and drips off.", stroke(0.0) + stroke(1.95),
                          chain={"eq": {"low_cut_hz": 70}, "room": {"size": 1.2, "decay": 0.4, "mix": 0.08}}))

    sounds.append(k.sound("distant_cannon", "impact", "A cannon far off across the water: a soft low boom with no crack, "
                          "rolling back off the shore. Never a close bang.", [
        k.noise(0.0, 2.6, "brown", env=[[0, 0, "cos"], [0.05, 1], [2.6, 0, "db"]], filt=k.lp(200), gain=0),
        k.tone(0.0, 1.3, [[0, 68, "exp"], [0.25, 38]], env=[[0, 0, "cos"], [0.035, 1], [1.3, 0, "db"]], gain=-3),
        k.noise(0.7, 3.4, "brown", env=[[0, 0, "cos"], [0.6, 1, "cos"], [3.4, 0, "db"]], filt=k.lp(150), gain=-10),
    ], chain={"eq": {"low_cut_hz": 35, "high_cut_hz": 800}, "room": {"size": 3.0, "decay": 3.2, "mix": 0.35}}))

    def squawk(t: float, lo: float, hi: float, length: float, gain: float, rough: float = 45, index: float = 3) -> dict:
        layer = k.fm(t, length, [[0, lo, "exp"], [length * 0.2, hi, "exp"], [length, lo * 1.1]], ratio=0.5, index=index,
                     env=[[0, 0, "cos"], [0.02, 1], [length * 0.7, 0.6, "cos"], [length, 0]], gain=gain)
        layer["tremolo"] = {"rate_hz": rough, "depth": 0.5}
        return filt(layer, k.bp((lo + hi) / 2, 0.7))
    chatter = [squawk(2.55 + i * 0.13, r(1100, 1500), r(1800, 2400), 0.08, -10, 0, 1.5) for i in range(7)]
    for c in chatter:
        c.pop("tremolo")
    sounds.append(k.sound("parrots", "foley", "Parrots in a shop: harsh squawks, a two-note whistle, a run of chatter, a "
                          "low raucous call. Small room.", [
        squawk(0.05, 1400, 2300, 0.32, -2), squawk(0.75, 1750, 2650, 0.24, -5),
        call(1.55, [[0, 1500, "exp"], [0.22, 2400]], 0.25, -6), call(1.9, [[0, 2100, "exp"], [0.3, 1650]], 0.32, -6),
        *chatter,
        squawk(3.4, 900, 1500, 0.45, -3, 60, 5),
    ], chain={"eq": {"low_cut_hz": 300}, "room": {"size": 0.5, "decay": 0.6, "mix": 0.18}}))

    # A great bell's partials as ratios to the hum: hum, prime, minor tierce, quint, nominal, the high partials.
    bell = [1, 2, 2.4, 3, 4, 5.33, 6, 8]
    sounds.append(k.sound("big_bell", "impact", "One stroke of a great bell: hum near 82 Hz with the strike note an octave "
                          "up, a minor tierce, a long ring in a large space.", [
        {**k.modal(0.0, 6.0, 82, 420, hardness=0.4, gain=0, detune=4, ratios=bell),
         "env": [[0, 1, "hold"], [3.8, 1, "cos"], [5.0, 0]]},
        k.thump(0.0, 120, 70, 0.15, gain=-16),
    ], chain={"eq": {"low_cut_hz": 50}, "room": {"size": 2.5, "decay": 2.0, "mix": 0.22}}))

    def crate(t: float, hz: float, gain: float) -> list[dict]:
        return [knock(t, hz, gain, length=0.35, t_d=3.2), {**k.modal(t, 0.4, hz * 0.45, 5, modes=2, hardness=0.3, gain=gain - 4)},
                k.thump(t, 115, 55, 0.18, gain=gain - 6), k.crack(t, gain=gain - 14, cutoff=1500),
                knock(t + 0.05, r(450, 650), gain - 12, length=0.12), knock(t + 0.1, r(450, 650), gain - 15, length=0.12)]
    sounds.append(k.sound("crates", "foley", "Crates being loaded: one set down on the quay, dragged a little, another dropped "
                          "on top, a lighter one knocked into place.", [
        *crate(0.05, 150, 0),
        filt({**k.noise(0.75, 0.9, "pink", env=[[0, 0, "cos"], [0.2, 1], [0.7, 0.8, "cos"], [0.9, 0]], gain=-9),
              "tremolo": {"rate_hz": 23, "depth": 0.6}}, k.bp(1200, 1.2)),
        k.noise(0.75, 0.9, "brown", env=[[0, 0, "cos"], [0.2, 1], [0.9, 0]], filt=k.lp(300), gain=-13),
        *crate(2.0, 240, -1),
        *crate(3.0, 330, -6),
    ], chain={"eq": {"low_cut_hz": 60}, "room": {"size": 1.0, "decay": 0.4, "mix": 0.1}}))

    def curlew(t: float, gain: float) -> list[dict]:
        return [call(t, [[0, 1600, "exp"], [0.42, 2300]], 0.45, gain),
                call(t + 0.52, [[0, 2250, "exp"], [0.3, 2500]], 0.32, gain - 1)]

    def redshank(t: float, gain: float, n: int = 3) -> list[dict]:
        return [call(t + i * 0.2, [[0, 2950, "exp"], [0.12, 2450]], 0.13, gain - i) for i in range(n)]

    def trill(t: float, length: float, gain: float) -> dict:
        layer = call(t, [[0, 2100, "exp"], [length * 0.4, 2650, "exp"], [length, 2250]], length, gain, trill=16)
        layer["vibrato"] = {"rate_hz": 16, "depth_cents": 60}
        return layer

    mud = {"type": "drops", "rate": 200, "r_min_mm": 0.5, "r_max_mm": 2, "size_slope": 3}
    sounds.append(k.sound("waders", "foley", "Wading birds on the mud: a curlew's rising call and bubbling trill, a redshank's "
                          "piping, small pops and trickles of the mud underneath.", [
        *curlew(0.2, -2), trill(1.4, 1.3, -3), *redshank(3.1, -6),
        k._layer(mud, 0, 5.0, [[0, 0, "cos"], [0.5, 1], [4.2, 1, "cos"], [5.0, 0]], -14),
        k.noise(0, 5.0, "pink", env=[[0, 0, "cos"], [0.5, 1], [4.2, 1, "cos"], [5.0, 0]], filt=k.lp(1200), gain=-24),
    ], chain={"eq": {"low_cut_hz": 120, "high_cut_hz": 7000}, "room": {"size": 2.0, "decay": 1.2, "mix": 0.22}}))

    flow_env = [[0, 0, "cos"], [0.9, 1], [4.6, 1, "cos"], [6.0, 0]]
    sounds.append(k.sound("water_flow", "ambience", "Water rushing underground: a dense stream of bubbles and a low roar in a "
                          "brick culvert.", [
        k._layer({"type": "drops", "rate": 30000, "r_min_mm": 0.3, "r_max_mm": 5, "size_slope": 2}, 0, 6.0, flow_env, 0),
        k.noise(0, 6.0, "brown", env=flow_env, filt=k.lp(500), gain=-3),
        k.noise(0, 6.0, "pink", env=flow_env, filt=k.bp(1400, 0.8), gain=-15),
    ], chain={"eq": {"low_cut_hz": 70}, "room": {"size": 2.5, "decay": 1.6, "mix": 0.3}}))

    # ---- soundscape loops ----------------------------------------------------------------------------------------
    L = LOOP_S
    loop = {"use": "loop", "loop": {"seconds": L}}

    rig = [k.wind(0, L, band_hz=300, turbulence=0.3, gust_hz=0.15, gain=-9),
           {**k.wind(0, L, band_hz=500, turbulence=0.2, gust_hz=0.1, gain=-16), "source": {
               "type": "wind", "band_hz": 500, "turbulence": 0.2, "gust_hz": 0.1, "whistle_hz": 760, "whistle_db": -10}}]
    t = 0.8
    while t < L - 1:
        rig.append(creak(t, r(80, 140), r(0.6, 1.1), r(-4, 0), centre=r(700, 1200)))
        t += r(2.6, 4.8)
    for t in (3.7, 11.2, 18.9, 25.4):
        rig += [knock(t, r(300, 420), -6), knock(t + r(0.18, 0.3), r(300, 420), -9)]
    for t in (7.5, 21.3):
        rig.append(filt({**k.noise(t, 3.0, "pink", env=[[0, 0, "cos"], [1.2, 1, "cos"], [3.0, 0]], gain=-13),
                         "tremolo": {"rate_hz": 9, "depth": 0.6}}, k.bp(450, 0.9)))
    sounds.append(k.sound("rigging", "ambience", "Rigging in the wind: a steady wind with a faint whistle in the shrouds, ropes "
                          "and timbers creaking, wooden blocks knocking, now and then a loose sail stirring.", rig,
                          chain={"eq": {"low_cut_hz": 60}, "room": {"size": 1.0, "decay": 0.5, "mix": 0.08}}, **loop))

    def hoof(t: float, gain: float) -> list[dict]:
        hz = r(850, 1350)
        return [knock(t, hz * 0.5, gain + 6, length=0.14, t_d=6), ring(t, hz, 9, 0.12, gain, hardness=0.9),
                k.noise(t, 0.04, "pink", env=k.decay(0.04, 0.001), filt=k.bp(hz * 0.6, 1.5), gain=gain - 2),
                k.crack(t, gain=gain - 8, cutoff=2200), k.thump(t, 220, 120, 0.07, gain=gain - 9)]
    pass_db = lambda x: -9 + 9 * (1 - abs(x - L / 2) / (L / 2)) ** 1.5  # noqa: E731  a cart nearing and going by
    cob: list[dict] = []
    t, i = 0.05, 0
    while t < L - 0.05:   # a horse at a walk: four beats a stride, in pairs
        cob += hoof(t, pass_db(t) + r(-2, 0))
        t += (0.22 if i % 2 == 0 else 0.36) + r(-0.02, 0.02)
        i += 1
    t = 0.4
    while t < L - 0.1:   # a second horse further off, out of step
        cob += hoof(t, -16 + r(-2, 0))
        t += (0.25 if i % 2 == 0 else 0.4) + r(-0.03, 0.03)
        i += 1
    wheel_env = [[x, 10 ** (pass_db(x) / 20)] for x in (0, 7.5, 15, 22.5, L)]
    cob += [filt({**k.noise(0, L, "brown", env=wheel_env, gain=-16), "tremolo": {"rate_hz": 13, "depth": 0.5}}, k.lp(420)),
            filt({**k.noise(0, L, "pink", env=wheel_env, gain=-28), "tremolo": {"rate_hz": 31, "depth": 0.6}}, k.bp(2400, 1.5)),
            k.noise(0, L, "pink", filt=k.lp(700), gain=-30)]
    sounds.append(k.sound("cobbles", "ambience", "Hooves and iron-rimmed wheels on cobbles: a horse and cart walking up and going "
                          "by, a second horse further off.", cob,
                          chain={"eq": {"low_cut_hz": 60}, "room": {"size": 1.4, "decay": 0.7, "mix": 0.15}}, **loop))

    def step(t: float, gain: float) -> list[dict]:
        return [k.noise(t, 0.07, "pink", env=k.decay(0.07, 0.002), filt=k.bp(r(1500, 2100), 1.0), gain=gain + 8),
                k.thump(t, 150, 90, 0.08, gain=gain), k.crack(t, gain=gain - 8, cutoff=3000)]
    tun = [k.noise(0, L, "brown", filt=k.lp(160), gain=-6), k.noise(0, L, "pink", filt=k.bp(380, 0.5), gain=-24)]
    t = 3.0
    while t < 20.0:   # someone walks up the tunnel and on past
        tun += step(t, -4 - 14 * abs(t - 11.5) / 8.5)
        t += 0.56 + r(-0.02, 0.02)
    t = 22.0
    while t < 29.5:   # a second walker, further off
        tun += step(t, -15 - 4 * abs(t - 25.7) / 3.7)
        t += 0.6 + r(-0.02, 0.02)
    sounds.append(k.sound("tunnel", "ambience", "The foot tunnel under the Thames: low air in a long tiled tube and footsteps "
                          "ringing as someone walks up and past, then another further off.", tun,
                          chain={"eq": {"low_cut_hz": 40}, "room": {"size": 2.6, "decay": 2.4, "mix": 0.3}}, **loop))

    wad = [k._layer({"type": "drops", "rate": 500, "r_min_mm": 0.4, "r_max_mm": 3, "size_slope": 2}, 0, L, None, -9),
           k.noise(0, L, "pink", filt=k.lp(1100), gain=-17)]
    for w in wad:
        w.pop("env", None)
    wad += curlew(1.5, -2) + curlew(17.0, -5)
    wad += [trill(5.2, 1.4, -8), trill(23.5, 1.2, -11)]
    wad += redshank(9.0, -9) + redshank(13.6, -12, 2) + redshank(20.4, -10, 4) + redshank(27.8, -13)
    for t in (11.8, 26.0):   # oystercatcher piping, a quick run of "kleep"
        wad += [call(t + i * 0.16, [[0, 3300, "exp"], [0.09, 2800]], 0.1, -14 - i * 0.5) for i in range(5)]
    sounds.append(k.sound("waders_loop", "ambience", "Wading birds on a tidal shore: mud trickling and popping, curlews calling "
                          "and trilling, redshanks piping, an oystercatcher's run, all at a distance.", wad,
                          chain={"eq": {"low_cut_hz": 110, "high_cut_hz": 6500}, "room": {"size": 2.2, "decay": 1.4, "mix": 0.28}},
                          **loop))

    dock = [k.noise(0, L, "brown", filt=k.lp(240), gain=-8), k.noise(0, L, "pink", filt=k.bp(500, 0.6), gain=-24)]
    t = 1.2
    while t < L - 1.5:   # iron struck somewhere across the dock
        dock.append(ring(t, r(280, 620), 200, 1.6, r(-4, 0), cut=2500))
        t += r(2.5, 5.5)
    for t0 in (4.0, 19.0):   # a hammer at work, a run of blows
        for i in range(rnd.randint(4, 6)):
            dock += [ring(t0 + i * 0.52, 760, 60, 0.4, 0, cut=3000), k.crack(t0 + i * 0.52, gain=-12, cutoff=1800)]
    for t0 in (9.0, 24.0):   # a steam winch chuffing
        for i in range(16):
            dock.append(k.noise(t0 + i * 0.26, 0.14, "pink", env=k.decay(0.14, 0.01), filt=k.bp(650, 1.2), gain=-4 - abs(i - 8) * 0.6))
    dock.append(filt({**k.noise(14.0, 1.8, "white", env=[[0, 0, "cos"], [0.2, 1], [1.8, 0]], gain=-12),
                      "tremolo": {"rate_hz": 24, "depth": 0.7}}, k.bp(2800, 2)))
    sounds.append(k.sound("dockyard", "ambience", "A working dock in the distance: a low working hum, iron ringing across the "
                          "water, a hammer at work, a steam winch, a chain running out.", dock,
                          chain={"eq": {"low_cut_hz": 45, "high_cut_hz": 4500}, "room": {"size": 3.0, "decay": 2.0, "mix": 0.4}},
                          **loop))
    return sounds


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skill", type=Path, required=True, help="the sfx-skill folder skills/sound-effects")
    ap.add_argument("--out", type=Path, default=HERE / "project.json")
    a = ap.parse_args()
    sys.path.insert(0, str(a.skill / "scripts"))
    import sfxkit  # noqa: E402
    sfxkit.save(a.out, "Versta sounds", build(sfxkit), variants=1, channels=1, seed=1911,
                notes="Effects and loops for Versta with no recording under its licence bar. Synthesis only.")
    print(f"wrote {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
