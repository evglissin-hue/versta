"""river: the working Thames, taverns, watermen.

D Dorian, 3/4 at 66 bpm, 24 bars (six phrases of four).
Harmony: Dm / C / G / Dm (the Dorian IV is a major chord, the folk sound), then F and Bb for a little lift, ending on
the dominant A so the loop returns to Dm with a real cadence. Accordion triads move by step.
Texture: a rocking nylon guitar (bass note, then the chord, alternating two patterns), a fretless bass holding roots,
and an accordion that holds soft triads and sings a short phrase once every eight bars or so.
"""
THEME = {
    "name": "river", "label": "River: the working Thames",
    "bpm": 66, "beats": 3, "bars": 24, "transpose": 0,
    "chords": {
        "Dm": "F3+A3+D4", "Dm2": "D3+F3+A3", "C": "E3+G3+C4", "G": "D3+G3+B3", "F": "F3+A3+C4",
        "Bb": "F3+Bb3+D4", "Am": "E3+A3+C4", "Gm": "D3+G3+Bb3", "A": "E3+A3+C#4", "Dsus": "E3+A3+D4",
    },
    "macros": {
        "pad": "0:{0}:3",
        "gA": "0:{0}:3 1:{1}:2 2:{2}:1",
        "gB": "0:{0}:3 1:{1}:2",
        "gEnd": "0:{0}:3",
    },
    "parts": [
        {"name": "guitar", "prog": 24, "ch": 0, "pan": -0.3, "vol": 100, "rev": 40, "vel": (46, 60), "strum": 18, "bars":
            "@gA(D3,A3,F4) | @gB(C3,E3+G3) | @gA(G2,D3,B3) | @gB(D3,F3+A3)"
            " | @gA(D3,A3,F4) | @gB(F2,A2+C3) | @gA(C3,G3,E4) | @gB(A2,C3+E3)"
            " | @gA(Bb2,F3,D4) | @gB(F2,A2+C3) | @gA(C3,G3,E4) | @gEnd(D3)"
            " | @gA(D3,A3,F4) | @gB(C3,E3+G3) | @gA(G2,D3,B3) | @gB(A2,C3+E3)"
            " | @gA(D3,A3,F4) | @gB(C3,E3+G3) | @gA(Bb2,F3,D4) | @gB(F2,A2+C3)"
            " | @gA(G2,D3,Bb3) | @gB(A2,C3+E3) | @gA(Bb2,F3,D4) | 0:A2:1.5 1.5:E3:1.5 2:C#4:1"},
        {"name": "bass", "prog": 35, "ch": 1, "pan": 0.0, "vol": 100, "rev": 25, "vel": (52, 62), "bars":
            "0:D2:3 | 0:C2:3 | 0:G1:3 | 0:D2:2 2:A1:1"
            " | 0:D2:3 | 0:F2:3 | 0:C2:3 | 0:A1:2 2:E2:1"
            " | 0:Bb1:3 | 0:F2:3 | 0:C2:3 | 0:D2:2 2:A1:1"
            " | 0:D2:3 | 0:C2:3 | 0:G1:3 | 0:A1:3"
            " | 0:D2:3 | 0:C2:3 | 0:Bb1:3 | 0:F2:3"
            " | 0:G1:3 | 0:A1:3 | 0:Bb1:3 | 0:A1:3"},
        {"name": "accordion", "prog": 21, "ch": 2, "pan": 0.3, "vol": 100, "rev": 60, "vel": (46, 54), "swell": (3, 80, 112), "bars":
            "@pad(Dm) | @pad(C) | @pad(G) | @pad(Dm2)"
            " | @pad(Dm2) | @pad(F) | @pad(C) | @pad(Am)"
            " | @pad(Bb) | @pad(F) | @pad(C) | @pad(Dm)"
            " | @pad(Dm) | @pad(C) | @pad(G) | @pad(Am)"
            " | @pad(Dm) | @pad(C) | @pad(Bb) | @pad(F)"
            " | @pad(Gm) | @pad(Am) | @pad(Bb) | @pad(A)"},
        {"name": "melody", "prog": 21, "ch": 3, "pan": 0.15, "vol": 100, "rev": 60, "vel": (44, 52), "bars":
            "- | - | - | - | 0:A4:1.5 1.5:G4:0.5 2:F4:1 | 0:E4:3 | 0:D4:2 2:E4:1 | 0:C4:3"
            " | - | - | - | - | - | - | - | -"
            " | 0:F4:1.5 1.5:E4:0.5 2:D4:1 | 0:C4:3 | 0:D4:2 2:F4:1 | 0:A3:3"
            " | - | - | - | -"},
    ],
}
