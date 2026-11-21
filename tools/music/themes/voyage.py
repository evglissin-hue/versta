"""voyage: ships and exploration.

D Lydian, 4/4 at 58 bpm, 16 bars.
Harmony: D(add9), E over D (the raised fourth, open water), Bm7, Gmaj7; D, A/C#, Bm, Gmaj7; Em7, D/F#, Gmaj7, A; D,
Bm7, Gmaj7, Asus4 which falls back to D. Strings move by step. The bass is a long arco note per bar.
Texture: strings swell slowly over eight bars and ebb again, a French horn calls in rising fourths and fifths in
two long phrases and goes quiet, and a harp drops a few single notes like spray.
"""
THEME = {
    "name": "voyage", "label": "Voyage: ships and exploration",
    "bpm": 58, "beats": 4, "bars": 16, "transpose": 0,
    "chords": {
        "D": "F#3+A3+D4+E4", "ED": "G#3+B3+D4+E4", "Bm7": "F#3+A3+B3+D4", "G": "G3+B3+D4+F#4", "D2": "F#3+A3+D4+F#4",
        "AC": "E3+A3+C#4+E4", "Bm": "F#3+B3+D4+F#4", "Em7": "G3+B3+D4+E4", "DF": "A3+D4+F#4", "A": "E3+A3+C#4+E4",
        "Asus": "E3+A3+D4+E4",
    },
    "macros": {"pad": "0:{0}:4", "harp": "0:{0}:0.8:34 0.7:{1}:0.8:32 1.4:{2}:2:30"},
    "parts": [
        {"name": "strings", "prog": 49, "ch": 0, "pan": -0.15, "vol": 100, "rev": 65, "vel": (38, 46), "swell": (8, 60, 112), "bars":
            "@pad(D) | @pad(ED) | @pad(Bm7) | @pad(G)"
            " | @pad(D2) | @pad(AC) | @pad(Bm) | @pad(G)"
            " | @pad(Em7) | @pad(DF) | @pad(G) | @pad(A)"
            " | @pad(D) | @pad(Bm7) | @pad(G) | @pad(Asus)"},
        {"name": "bass", "prog": 43, "ch": 1, "pan": 0.0, "vol": 100, "rev": 40, "vel": (48, 56), "bars":
            "0:D2:4 | 0:D2:4 | 0:B1:4 | 0:G1:4"
            " | 0:D2:4 | 0:C#2:4 | 0:B1:4 | 0:G1:4"
            " | 0:E2:4 | 0:F#2:4 | 0:G1:4 | 0:A1:4"
            " | 0:D2:4 | 0:B1:4 | 0:G1:4 | 0:A1:4"},
        {"name": "horn", "prog": 60, "ch": 2, "pan": 0.2, "vol": 88, "rev": 65, "vel": (42, 52), "bars":
            "0:A3:2 2:D4:2 | 0:E4:4 | 0:D4:2 2:F#4:2 | 0:B3:4"
            " | - | - | - | -"
            " | 0:G3:2 2:B3:2 | 0:A3:4 | 0:B3:2 2:D4:2 | 0:E4:4"
            " | 0:D4:2 2:A3:2 | 0:F#3:4 | 0:G3:4 | 0:A3:4"},
        {"name": "harp", "prog": 46, "ch": 3, "pan": 0.3, "vol": 100, "rev": 70, "vel": (34, 42), "bars":
            "- | - | - | - | @harp(D4,A4,F#4) | - | @harp(B3,D4,F#4) | -"
            " | - | - | - | @harp(E4,A4,C#5) | - | - | @harp(G3,B3,D4) | -"},
    ],
}
