"""Record narration for a route pack with the Kokoro text-to-speech model (kokoro-onnx).
Generates only files that are missing: passing-by stories (asides), turn cues and system clips.
Main story narration is produced by tools/narrate_stories.py, which also writes paragraph marks.
Usage: KOKORO_DIR=/path/to/models python3 tools/narrate.py thames-loop"""
import json, os, re, subprocess, sys, numpy as np, soundfile as sf
from kokoro_onnx import Kokoro
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PACK = sys.argv[1] if len(sys.argv) > 1 else "thames-loop"
KD = os.environ.get("KOKORO_DIR", "/home/claude/tts")
VOICE = "bm_george"
ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split()
TENS = "x x twenty thirty forty fifty sixty seventy eighty ninety".split()
def two(n): return ONES[n] if n < 20 else TENS[n // 10] + ("" if n % 10 == 0 else " " + ONES[n % 10])
def year(m):
    y = int(m.group(1)); a, b = divmod(y, 100)
    if m.group(2): return two(a) + " " + {20: "twenties", 30: "thirties", 40: "forties", 50: "fifties", 60: "sixties", 70: "seventies", 80: "eighties", 90: "nineties"}[b]
    return two(a) + (" hundred" if b == 0 else " oh " + ONES[b] if b < 10 else " " + two(b))
SUBS = [("MI5", "M I five"), ("Deptford", "Detford"), ("Greenwich", "Grennitch"), ("Wapping", "Wopping"), ("Thames", "Tems"),
        ("St ", "Saint "), ("Glamis", "Glahms"), ("Okhrana", "Okrahna"), ("Skeres", "Skeers"), ("Lody", "Loady"), ("Josef Jakobs", "Yosef Yakobs"),
        (" & ", " and "), ("Haakon", "Hawkon"), ("Temeraire", "Temmerair"), ("Ravensbourne", "Ravensborn"), ("Hawksmoor", "Hawksmore"),
        ("Bunhill", "Bunnhill"), ("Fournier", "Foornier"), ("Whitby", "Witby")]
def norm(t):
    t = re.sub(r"\b(1[3-9]\d\d)(s?)\b", year, t)
    for a, b in SUBS: t = t.replace(a, b)
    assert not re.search(r"\d", t), t
    return t
k = Kokoro(os.path.join(KD, "kokoro-v1.0.onnx"), os.path.join(KD, "voices-v1.0.bin"))
base = os.path.join(ROOT, "public", "packs", PACK)
pack = json.load(open(os.path.join(base, "pack.json")))
def record(text, rel, speed, lead, tail=0.25):
    out = os.path.join(base, rel)
    if os.path.exists(out): return
    os.makedirs(os.path.dirname(out), exist_ok=True)
    a, sr = k.create(norm(text), voice=VOICE, speed=speed, lang="en-gb")
    a = np.concatenate([np.zeros(int(sr * lead), dtype=np.float32), a.astype(np.float32), np.zeros(int(sr * tail), dtype=np.float32)])
    sf.write("/tmp/n.wav", a, sr)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", "/tmp/n.wav", "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", "24000", "-ac", "1", "-b:a", "48k", out], check=True)
    print(rel, flush=True)
for c in pack["cues"]:
    if not c.get("quiet"): record(c["say"], c["audio"], 1.0, 0.05)
for s, rel in zip(pack["stops"], pack["system"]["arrive"]): record("Arriving at " + s["name"] + ".", rel, 1.0, 0.05)
record("You are off the route.", pack["system"]["offRoute"], 1.0, 0.05)
record("Back on the route.", pack["system"]["backOnRoute"], 1.0, 0.05)
for a in pack["asides"]: record(a["text"], a["audio"], 0.94, 0.9, 0.5)
print("NARRATE_DONE", flush=True)
