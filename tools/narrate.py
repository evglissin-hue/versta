"""Record narration for a route pack with the Kokoro text-to-speech model (kokoro-onnx).
Generates only files that are missing: passing-by stories (asides), turn cues and system clips.
Main story narration is produced by tools/narrate_stories.py, which also writes paragraph marks.
Usage: KOKORO_DIR=/path/to/models python3 tools/narrate.py thames-loop"""
import json, os, re, sys, numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import voice
from kokoro_onnx import Kokoro
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PACK = sys.argv[1] if len(sys.argv) > 1 else "thames-loop"
KD = os.environ.get("KOKORO_DIR", "/home/claude/tts")
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
FORCE = "--force" in sys.argv
def record(text, rel, speed, lead, tail=0.25):
    out = os.path.join(base, rel)
    if os.path.exists(out) and not FORCE: return
    os.makedirs(os.path.dirname(out), exist_ok=True)
    a, sr = k.create(norm(text), voice=voice.VOICE, speed=speed, lang=voice.LANG)
    a = np.concatenate([np.zeros(int(sr * lead), dtype=np.float32), a.astype(np.float32), np.zeros(int(sr * tail), dtype=np.float32)])
    voice.encode(a, sr, out)
    print(rel, flush=True)
TURN_SAY = {"left": "Turn left.", "right": "Turn right.", "slight_left": "Bear left.", "slight_right": "Bear right.",
            "sharp_left": "Sharp left.", "sharp_right": "Sharp right.", "straight": "Continue straight."}
sysp = pack["system"]
for c in pack["cues"]:
    if not c.get("quiet"): record(c["say"], c["audio"], voice.SPEED_CUE, voice.LEAD_CUE)
for s, rel in zip(pack["stops"], sysp["arrive"]): record("Arriving at " + s["name"] + ".", rel, voice.SPEED_CUE, voice.LEAD_CUE)
record("You are off the route.", sysp["offRoute"], voice.SPEED_CUE, voice.LEAD_CUE)
record("Back on the route.", sysp["backOnRoute"], voice.SPEED_CUE, voice.LEAD_CUE)
if sysp.get("rerouting"): record("Finding a way back to the route.", sysp["rerouting"], voice.SPEED_CUE, voice.LEAD_CUE)
for kind, rel in sysp.get("turns", {}).items(): record(TURN_SAY[kind], rel, voice.SPEED_CUE, voice.LEAD_CUE)
DIST_SAY = {"50": "In fifty metres,", "100": "In one hundred metres,", "150": "In one hundred and fifty metres,", "200": "In two hundred metres,", "300": "In three hundred metres,"}
# distance prefixes run straight into the turn cue that follows, so they get no tail silence to speak of
for d, rel in sysp.get("distances", {}).items(): record(DIST_SAY[d], rel, voice.SPEED_CUE, voice.LEAD_CUE)
if sysp.get("wrongWay"): record("You are riding against the route. Turn around when you can.", sysp["wrongWay"], voice.SPEED_CUE, voice.LEAD_CUE)
for a in pack["asides"]: record(a["text"], a["audio"], voice.SPEED_STORY, voice.LEAD_ASIDE, 0.5)
# remove cue files that no longer belong to the pack
want = {c["audio"] for c in pack["cues"] if not c.get("quiet")}
for fn in sorted(os.listdir(os.path.join(base, "cues"))):
    if "cues/" + fn not in want:
        os.remove(os.path.join(base, "cues", fn)); print("removed orphan cue", fn)
print("NARRATE_DONE", flush=True)
