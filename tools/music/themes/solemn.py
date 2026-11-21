"""solemn: loss and remembrance.

A minor (Aeolian), 4/4 at 56 bpm, 15 bars.
Harmony: Am, Fmaj7, Dm, Am/E; Fmaj7, G, Am, Em/G; F, Dm7, Bbmaj7 (a borrowed colour, the light going), then E7 so the
loop turns back to Am. The string chords move by step, the E7 dominant brings a G sharp the rest of the theme lacks.
Texture: a cello that mostly holds one long note per bar and sings four short falling phrases, a slow string pad
under it, and a piano that only puts down a low open fifth on the bar and, four times, a single high note.
"""
THEME = {
    "name": "solemn", "label": "Solemn: loss and remembrance",
    "bpm": 56, "beats": 4, "bars": 15, "transpose": 0,
    "chords": {
        "Am": "E3+A3+C4", "Am_hi": "A3+C4+E4", "F7": "F3+A3+C4+E4", "Dm": "F3+A3+D4", "AmE": "E3+A3+C4",
        "G": "G3+B3+D4", "EmG": "G3+B3+E4", "F": "F3+A3+C4", "Dm7": "F3+A3+C4+D4", "Bb7": "F3+A3+Bb3+D4",
        "E7": "E3+G#3+B3+D4", "Am9": "E3+A3+C4+E4",
    },
    "macros": {"pad": "0:{0}:4", "fifth": "0:{0}:4", "high": "0:{0}:4 1.5:{1}:2.5:30"},
    "parts": [
        {"name": "strings", "prog": 49, "ch": 0, "pan": -0.1, "vol": 100, "rev": 60, "vel": (36, 44), "swell": (5, 70, 110), "bars":
            "@pad(Am) | @pad(F7) | @pad(Dm) | @pad(AmE)"
            " | @pad(F7) | @pad(G) | @pad(Am_hi) | @pad(EmG)"
            " | @pad(F) | @pad(Dm7) | @pad(Bb7) | @pad(E7)"
            " | @pad(Am9) | @pad(F7) | @pad(E7)"},
        {"name": "cello", "prog": 42, "ch": 1, "pan": 0.15, "vol": 100, "rev": 55, "vel": (50, 62), "bars":
            "0:A2:4 | 0:F2:4 | 0:D2:4 | 0:E2:4"
            " | 0:A3:3 3:G3:1 | 0:B3:4 | 0:C4:2 2:A3:2 | 0:G3:4"
            " | 0:A3:2 2:C4:2 | 0:D4:3 3:C4:1 | 0:D4:4 | 0:G#3:4"
            " | 0:A3:4 | 0:C4:2 2:A3:2 | 0:B3:3 3:G#3:1"},
        {"name": "piano", "prog": 0, "ch": 2, "pan": -0.15, "vol": 100, "rev": 60, "vel": (40, 50), "strum": 90, "bars":
            "@fifth(A2+E3) | @fifth(F2+C3) | @fifth(D2+A2) | @fifth(E2+B2)"
            " | @high(F2+C3,E5) | @fifth(G2+D3) | @fifth(A2+E3) | @fifth(E2+B2)"
            " | @high(F2+C3,C5) | @fifth(D2+A2) | @fifth(Bb1+F2) | @fifth(E2+B2)"
            " | @high(A2+E3,E5) | @fifth(F2+C3) | @fifth(E2+B2)"},
    ],
}
