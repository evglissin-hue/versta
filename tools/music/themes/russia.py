"""russia: Russian history, Peter's shipyard, the revolutionaries.

E minor, 4/4 at 60 bpm, 16 bars.
Harmony: the Andalusian fall Em, D, C, B (the B is a major chord with D sharp, the sound of harmonic minor), then
Em, Em, Am, B, then the fall again, and Am, C, D, B to lead back to Em. A low E and B drone never moves, so every
chord sits against it. The choir descends by step, each chord one tone or semitone lower than the last.
Texture: contrabass drone, choir voices on the chord, and a tremolo nylon guitar (the nearest thing to a balalaika)
that plays six slow phrases of one or two notes and rests for long stretches.
"""
THEME = {
    "name": "russia", "label": "Russia",
    "bpm": 60, "beats": 4, "bars": 16, "transpose": 0,
    "chords": {
        "Em": "B2+E3+G3", "Ema": "G2+B2+E3", "D": "A2+D3+F#3", "C": "G2+C3+E3", "B": "F#2+B2+D#3", "Am": "A2+C3+E3",
    },
    "macros": {"pad": "0:{0}:4", "drone": "0:E2+B2:4"},
    "parts": [
        {"name": "drone", "prog": 43, "ch": 0, "pan": 0.0, "vol": 100, "rev": 45, "vel": (44, 50), "bars":
            "@drone*16"},
        {"name": "choir", "prog": 52, "ch": 1, "pan": -0.1, "vol": 100, "rev": 70, "vel": (40, 48), "swell": (4, 75, 110), "bars":
            "@pad(Em) | @pad(D) | @pad(C) | @pad(B)"
            " | @pad(Ema) | @pad(Ema) | @pad(Am) | @pad(B)"
            " | @pad(Em) | @pad(D) | @pad(C) | @pad(B)"
            " | @pad(Am) | @pad(C) | @pad(D) | @pad(B)"},
        {"name": "tremolo", "prog": 24, "ch": 2, "pan": 0.25, "vol": 100, "rev": 55, "vel": (46, 58), "trem": 0.125, "bars":
            "- | - | 0:G4:2t 2:E4:2t | 0:D#4:4t"
            " | - | 0:E4:1t 1:G4:1t 2:B4:2t | 0:C5:2t 2:B4:2t | 0:A4:1t 1:F#4:3t"
            " | - | - | 0:G4:2t 2:E4:2t | 0:D#4:2t 2:F#4:2t"
            " | 0:A4:4t | 0:G4:2t 2:E4:2t | 0:F#4:4t | 0:D#4:4t"},
    ],
}
