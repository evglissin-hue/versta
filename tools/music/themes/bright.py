"""bright: light and forward, the jolly stories.

G major, 4/4 at 72 bpm, 20 bars.
Harmony: G, D/F#, Em, C; G, D, C, D; Em, C, G, D; C, G/B, Am7, D7; G, Em, C, D. Plain and open: I, V, vi, IV in
different orders so it keeps moving, with a D7 turn before the last phrase.
Texture: a nylon guitar picking the chord in a gentle pattern, pizzicato strings answering on beats 2 and 4, and a
clarinet in its low register with six short tunes, two bars each at most, and long rests between.
"""
THEME = {
    "name": "bright", "label": "Bright: light and forward",
    "bpm": 72, "beats": 4, "bars": 20, "transpose": 0,
    "chords": {
        "G": "B3+D4", "DF": "A3+D4", "Em": "G3+B3", "C": "G3+C4", "D": "A3+D4", "Am7": "G3+C4", "D7": "A3+C4", "GB": "G3+D4",
    },
    "macros": {
        "pick": "0:{0}:2 1:{1}:1 1.5:{2}:0.5 2:{3}:1 3:{1}:1",
        "pizz": "1:{0}:0.4 3:{0}:0.4",
    },
    "parts": [
        {"name": "guitar", "prog": 24, "ch": 0, "pan": -0.3, "vol": 100, "rev": 35, "vel": (48, 60), "bars":
            "@pick(G2,D3,B3,G3) | @pick(F#2,A2,D3,A3) | @pick(E2,B2,G3,B3) | @pick(C3,G3,E3,C4)"
            " | @pick(G2,D3,B3,G3) | @pick(D3,A3,F#3,D4) | @pick(C3,G3,E3,C4) | @pick(D3,A3,F#3,D4)"
            " | @pick(E2,B2,G3,B3) | @pick(C3,G3,E3,C4) | @pick(G2,D3,B3,G3) | @pick(D3,A3,F#3,D4)"
            " | @pick(C3,G3,E3,C4) | @pick(B2,D3,G3,D4) | @pick(A2,E3,C4,E4) | @pick(D3,A3,F#3,C4)"
            " | @pick(G2,D3,B3,G3) | @pick(E2,B2,G3,B3) | @pick(C3,G3,E3,C4) | @pick(D3,A3,F#3,D4)"},
        {"name": "pizz", "prog": 45, "ch": 1, "pan": 0.3, "vol": 100, "rev": 45, "vel": (40, 52), "bars":
            "- | - | @pizz(Em) | @pizz(C)"
            " | @pizz(G) | @pizz(D) | @pizz(C) | @pizz(D)"
            " | @pizz(Em) | @pizz(C) | @pizz(G) | @pizz(D)"
            " | @pizz(C) | @pizz(GB) | @pizz(Am7) | @pizz(D7)"
            " | @pizz(G) | @pizz(Em) | @pizz(C) | -"},
        {"name": "clarinet", "prog": 71, "ch": 2, "pan": 0.1, "vol": 78, "rev": 50, "vel": (44, 54), "bars":
            "- | - | 0:E4:1 1:G4:1 2:B3:2 | 0:C4:1 1:E4:1 2:D4:2"
            " | - | - | - | -"
            " | 0:B3:1 1:E4:1 2:G4:2 | 0:E4:2 2:D4:1 3:C4:1 | 0:B3:4 | -"
            " | 0:G4:1 1:E4:1 2:C4:2 | 0:D4:1 1:B3:1 2:G3:2 | 0:A3:1 1:C4:1 2:E4:2 | 0:F#4:3 3:E4:1"
            " | - | - | 0:E4:2 2:G4:2 | 0:F#4:4"},
    ],
}
