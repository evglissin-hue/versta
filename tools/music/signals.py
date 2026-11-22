"""The three signature motifs, in C major. Times are in seconds (the render runs at 60 bpm, one beat a second).

Each note is (start, pitches joined by +, length, velocity). "length" is the length of the file.

arrive  a rising figure of three notes on the celesta (E, G, C) over a soft string chord. About 2 s.
close   a falling two-note figure on the vibraphone (D, then C, home) over a low soft chord. About 2.5 s, quieter.
finish  a harp arpeggio rising in five notes into a held C major chord with a glockenspiel on top. About 4 s.
Not a bell: all three are soft attacks on pitched instruments, and each has its own register.
"""
SIGNALS = {
    "arrive": {"length": 2.0, "reverb": (0.6, 0.5, 0.45), "parts": [
        {"ch": 0, "prog": 8, "pan": 0.0, "vol": 100, "rev": 50,
         "notes": [(0.0, "E5", 1.5, 78), (0.3, "G5", 1.4, 80), (0.6, "C6", 1.4, 84)]},
        {"ch": 1, "prog": 49, "pan": 0.0, "vol": 90, "rev": 40,
         "notes": [(0.0, "C3+G3+E4", 1.9, 42)]},
    ]},
    "close": {"length": 2.5, "reverb": (0.65, 0.5, 0.5), "parts": [
        {"ch": 0, "prog": 11, "pan": 0.0, "vol": 100, "rev": 55,
         "notes": [(0.0, "D5", 1.0, 62), (0.55, "C5", 1.9, 58)]},
        {"ch": 1, "prog": 49, "pan": 0.0, "vol": 90, "rev": 45,
         "notes": [(0.35, "C3+G3", 2.1, 34)]},
    ]},
    ]},
    "finish": {"length": 4.0, "reverb": (0.75, 0.5, 0.5), "parts": [
        {"ch": 0, "prog": 46, "pan": 0.0, "vol": 100, "rev": 55,
         "notes": [(0.0, "C4", 2.0, 70), (0.22, "E4", 2.0, 72), (0.44, "G4", 2.0, 74), (0.66, "C5", 2.2, 78), (0.88, "E5", 2.4, 80)]},
        {"ch": 1, "prog": 49, "pan": 0.0, "vol": 95, "rev": 50,
         "notes": [(0.8, "C3+G3+C4+E4+G4", 3.0, 50)]},
        {"ch": 2, "prog": 9, "pan": 0.0, "vol": 90, "rev": 60,
         "notes": [(1.1, "G5", 2.5, 44)]},
    ]},
}
