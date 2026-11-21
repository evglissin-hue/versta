"""noir: spies and secrets, London 1910s to 1940s. Smoky, patient, a little dangerous.

Written in D minor, sounds in C minor (transpose -2). Four phrases of four bars.
Harmony: i (Dm9) / bVI (Bbmaj7) / A7b9 (the dominant, always unresolved for a bar) / iv (Gm9) / Em7b5, ending each
phrase on the dominant so the loop falls back into Dm. The Rhodes voicings move by step, one or two voices at a time.
Texture: slow walking bass, Rhodes chords with a late soft re-strike, a hint of brushes from bar 3, and a muted
trumpet that speaks in three short phrases and leaves most of the bars empty.
"""
THEME = {
    "name": "noir", "label": "Noir: spies and secrets",
    "bpm": 60, "beats": 4, "bars": 16, "transpose": -2,
    "chords": {
        "Dm9": "F3+A3+C4+E4", "Bbm7": "F3+A3+C4+D4", "A7b9": "G3+Bb3+C#4+E4", "Gm9": "F3+A3+Bb3+D4",
        "Em7b5": "E3+G3+Bb3+D4", "A7s9": "E3+G3+C4+C#4", "Bb11": "F3+A3+D4+E4", "Gm6": "G3+Bb3+D4+E4",
    },
    "macros": {
        "ep": "0:{0}:3.6",
        "ep2": "0:{0}:2 2.5:{0}:1.3:34",
        "brush": "0:40:1.8:68 1:44:0.3:60 2:40:1.8:64 3:44:0.3:56",
        "brush2": "0:40:1.8:68 1:44:0.3:60 2:40:1.8:64 3:44:0.3:56 3.5:38:0.2:50",
    },
    "parts": [
        {"name": "bass", "prog": 32, "ch": 0, "pan": 0.0, "vol": 100, "rev": 30, "vel": (62, 76), "bars":
            "0:D2:4 | 0:D2:2 2:F2:1 3:E2:1 | 0:Bb1:2 2:F2:2 | 0:A1:2 2:C#2:1 3:E2:1"
            " | 0:D2:2 2:A1:2 | 0:G1:2 2:D2:2 | 0:E2:2 2:G2:2 | 0:A1:2 2:E2:1 3:C#2:1"
            " | 0:Bb1:2 2:F2:2 | 0:G1:2 2:D2:1 3:F2:1 | 0:E2:2 2:G2:1 3:Bb1:1 | 0:A1:2 2:C#2:1 3:E2:1"
            " | 0:D2:2 2:A1:2 | 0:Bb1:2 2:F2:2 | 0:G1:2 2:D2:1 3:E2:1 | 0:A1:2 2:E2:2"},
        {"name": "rhodes", "prog": 4, "ch": 1, "pan": -0.2, "vol": 100, "rev": 55, "vel": (36, 48), "strum": 28, "bars":
            "@ep2(Dm9) | @ep(Dm9) | @ep2(Bbm7) | @ep(A7b9)"
            " | @ep2(Dm9) | @ep(Gm9) | @ep2(Em7b5) | @ep(A7b9)"
            " | @ep2(Bbm7) | @ep(Gm9) | @ep2(Em7b5) | @ep(A7s9)"
            " | @ep2(Dm9) | @ep(Bb11) | @ep2(Gm6) | @ep(A7b9)"},
        {"name": "brushes", "prog": 40, "ch": 9, "pan": 0.15, "vol": 100, "rev": 25, "vel": (62, 74), "bars":
            "- | - | @brush | @brush | @brush | @brush2 | @brush | @brush2 | @brush | @brush | @brush | @brush2"
            " | @brush | @brush | @brush | @brush2"},
        {"name": "trumpet", "prog": 59, "ch": 2, "pan": 0.3, "vol": 100, "rev": 60, "vel": (38, 46), "bars":
            "- | - | - | - | 0:A4:2 2:G4:1 3:F4:1 | 0:D4:4 | - | 2:E4:2"
            " | 0:D5:3 | - | - | - | 0:F4:2 2:A4:1 3:G4:1 | 0:F4:4 | - | -"},
    ],
}
