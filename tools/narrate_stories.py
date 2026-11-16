"""Record the main story narration with paragraph marks (Kokoro text-to-speech).
Writes public/packs/<id>/audio/<stop>-<n>.mp3 and tools/content/<id>.audio.json (src, marks, dur).
Usage: KOKORO_DIR=/path/to/models python3 tools/narrate_stories.py"""
import json, re, os, subprocess, sys, time, numpy as np, soundfile as sf
from kokoro_onnx import Kokoro
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KD = os.environ.get("KOKORO_DIR", "/home/claude/tts")
PACK = "thames-loop"
ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split()
TENS = "x x twenty thirty forty fifty sixty seventy eighty ninety".split()
def two(n):
    if n < 20: return ONES[n]
    return TENS[n//10] + ("" if n % 10 == 0 else " " + ONES[n % 10])
def year(m):
    y = int(m.group(1)); dec = m.group(2)
    a, b = divmod(y, 100)
    if dec:
        t = {20:"twenties",30:"thirties",40:"forties",50:"fifties",60:"sixties",70:"seventies",80:"eighties",90:"nineties"}[b]
        return two(a) + " " + t
    if b == 0: return two(a) + " hundred"
    if b < 10: return two(a) + " oh " + ONES[b]
    return two(a) + " " + two(b)
SUBS = [("MI5","M I five"),("Deptford","Detford"),("Greenwich","Grennitch"),("Wapping","Wopping"),("Thames","Tems"),
        ("St Nicholas","Saint Nicholas"),("St Petersburg","Saint Petersburg"),("Lody","Loady"),("Josef Jakobs","Yosef Yakobs"),
        ("Okhrana","Okrahna"),("Skeres","Skeers"),("Spitsbergen","Spitsbergen")]
def norm(t):
    t = re.sub(r"\b(1[5-9]\d\d)(s?)\b", year, t)
    for a, b in SUBS: t = t.replace(a, b)
    assert not re.search(r"\d", t), t
    return t
k = Kokoro(os.path.join(KD, "kokoro-v1.0.onnx"), os.path.join(KD, "voices-v1.0.bin"))
routes = json.load(open(os.path.join(ROOT, "tools", "content", PACK + ".route.json")))
man = {}
mpath = os.path.join(ROOT, "tools", "content", PACK + ".audio.json")
if os.path.exists(mpath): man = json.load(open(mpath))
t0 = time.time()
for r in routes:
    OUT = os.path.join(ROOT, "public", "packs", r["id"], "audio"); os.makedirs(OUT, exist_ok=True)
    for s in r["stops"]:
        for ki, st in enumerate(s["stories"]):
            key = f"{r['id']}/{s['id']}-{ki}"
            fn = os.path.join(OUT, f"{s['id']}-{ki}.mp3")
            if key in man and os.path.exists(fn): continue
            sr = 24000; parts = [np.zeros(int(sr*1.6), dtype=np.float32)]; marks = []; pos = 1.6
            for p in st["paras"]:
                a, sr2 = k.create(norm(p), voice="bm_george", speed=0.92, lang="en-gb"); assert sr2 == sr
                a = a.astype(np.float32); marks.append(round(pos, 2)); parts.append(a); pos += len(a)/sr
                gap = 0.7; parts.append(np.zeros(int(sr*gap), dtype=np.float32)); pos += gap
            audio = np.concatenate(parts)
            sf.write("/tmp/x.wav", audio, sr)
            subprocess.run(["ffmpeg","-y","-loglevel","error","-i","/tmp/x.wav","-af","loudnorm=I=-16:TP=-1.5:LRA=11","-ar","24000","-ac","1","-b:a","48k",fn], check=True)
            man[key] = {"src": f"audio/{key}.mp3", "marks": marks, "dur": round(len(audio)/sr, 1)}
            json.dump(man, open(mpath, "w"))
            print(key, man[key]["dur"], "elapsed %.0fs" % (time.time()-t0), flush=True)
print("DONE", flush=True)
