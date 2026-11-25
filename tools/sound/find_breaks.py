"""Find the phrase starts in the narration clips of a pack and write tools/content/<pack_id>.breaks.json.

Usage: python3 tools/sound/find_breaks.py <pack_id>

A break is the second at which speech resumes after a pause: the silence_end of ffmpeg
silencedetect=noise=-38dB:d=0.28, rounded to 0.01 s. The leading silence is kept (its end is the first onset of the
clip). A silence that ends within 0.3 s of the end of the clip is the tail, not a phrase, and is dropped.
For every story, each paragraph mark is a phrase start by definition: when no break lies within 0.15 s of a mark,
the mark itself is added as a break and a line says so. The marks come from the audio manifest
(tools/content/<pack_id>.audio.json, written by narrate_stories.py), so a re-recorded story is right before the pack
is rebuilt; a clip the manifest does not list keeps the marks in pack.json.
Clips are every story clip and every aside clip the pack names. The file is keyed by path in the pack folder, because
two stories can share a clip and pack ids can differ from content ids.
"""
import json, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TAIL = 0.3
MARK_TOL = 0.15


def probe_dur(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                         capture_output=True, text=True, check=True).stdout.strip()
    return round(float(out), 2)


def silence_ends(path):
    r = subprocess.run(["ffmpeg", "-nostats", "-hide_banner", "-i", path, "-af", "silencedetect=noise=-38dB:d=0.28",
                        "-f", "null", "-"], capture_output=True, text=True, check=True)
    return [float(m) for m in re.findall(r"silence_end:\s*(-?[0-9.]+)", r.stderr)]


def find(path):
    dur = probe_dur(path)
    breaks = sorted({round(max(0.0, e), 2) for e in silence_ends(path) if e < dur - TAIL})
    return dur, breaks


def main():
    pack_id = sys.argv[1] if len(sys.argv) > 1 else "thames-loop"
    folder = os.path.join(ROOT, "public", "packs", pack_id)
    pack = json.load(open(os.path.join(folder, "pack.json"), encoding="utf-8"))
    marks = {}  # clip path -> paragraph marks of every story using it
    clips = set()
    for stop in pack["stops"]:
        for story in stop["stories"]:
            a = story.get("audio")
            if a:
                clips.add(a["src"])
                marks.setdefault(a["src"], []).extend(a.get("marks", []))
    for aside in pack["asides"]:
        clips.add(aside["audio"])
    # the marks of a re-recorded story are in the audio manifest before a pack is rebuilt with them: they win
    man = os.path.join(ROOT, "tools", "content", f"{pack_id}.audio.json")
    if os.path.exists(man):
        for key, a in json.load(open(man, encoding="utf-8")).items():
            rel = f"audio/{key.split('/', 1)[1]}.mp3"
            if rel in clips: marks[rel] = list(a.get("marks", []))
    out = {}
    for rel in sorted(clips):
        dur, breaks = find(os.path.join(folder, rel))
        for m in sorted(set(marks.get(rel, []))):
            if not any(abs(b - m) <= MARK_TOL for b in breaks):
                breaks = sorted(breaks + [round(m, 2)])
                print(f"{rel}: no break within {MARK_TOL} s of paragraph mark {m}, added the mark as a break")
        out[rel] = {"dur": dur, "breaks": breaks}
        print(f"{rel}: {dur} s, {len(breaks)} breaks")
    dest = os.path.join(ROOT, "tools", "content", f"{pack_id}.breaks.json")
    lines = [f"{json.dumps(k, ensure_ascii=False)}: {json.dumps(out[k], separators=(',', ':'))}" for k in sorted(out)]
    with open(dest, "w", encoding="utf-8") as f:
        f.write("{\n" + ",\n".join(lines) + "\n}\n")
    print("wrote", os.path.relpath(dest, ROOT))


if __name__ == "__main__":
    main()
