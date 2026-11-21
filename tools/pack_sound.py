"""The single place that writes sound fields into a pack.

As a module: apply(pack, pack_id) -> list of problems (empty when fine); fills story.audio.breaks and aside.breaks.
As a command: python3 tools/pack_sound.py <pack_id> loads public/packs/<id>/pack.json, applies, and writes it back the
way build_pack.py writes it. On any problem it prints them and writes nothing. A full build_pack.py run needs cached
OpenStreetMap extracts, so sound fields must be updatable without touching the map work.
"""
import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONTENT = os.path.join(ROOT, "tools", "content")
MARK_TOL = 0.15


def load_breaks(pack_id):
    fn = os.path.join(CONTENT, f"{pack_id}.breaks.json")
    if not os.path.exists(fn):
        return None, [f"missing tools/content/{pack_id}.breaks.json (run tools/sound/find_breaks.py {pack_id})"]
    try:
        return json.load(open(fn, encoding="utf-8")), []
    except json.JSONDecodeError as e:
        return None, [f"tools/content/{pack_id}.breaks.json is not valid JSON: {e}"]


def check_clip(label, rel, entry, marks):
    if entry is None:
        return [f"{label}: no entry for {rel} in the breaks file (run tools/sound/find_breaks.py)"]
    br, dur = entry.get("breaks"), entry.get("dur")
    if not isinstance(br, list) or not isinstance(dur, (int, float)):
        return [f"{label}: the breaks entry for {rel} needs dur and breaks"]
    bad = []
    if any(b2 <= b1 for b1, b2 in zip(br, br[1:])): bad.append(f"{label}: breaks of {rel} are not ascending")
    if any(not (0 <= b < dur) for b in br): bad.append(f"{label}: a break of {rel} is outside the clip (0 to {dur})")
    for m in marks:
        if not any(abs(b - m) <= MARK_TOL for b in br):
            bad.append(f"{label}: paragraph mark {m} of {rel} has no break within {MARK_TOL} s")
    return bad


def apply_breaks(pack, pack_id):
    data, problems = load_breaks(pack_id)
    if data is None: return problems
    for stop in pack["stops"]:
        for story in stop["stories"]:
            a = story.get("audio")
            if not a: continue
            entry = data.get(a["src"])
            bad = check_clip(f"story {story['id']}", a["src"], entry, a.get("marks", []))
            problems += bad
            if not bad: a["breaks"] = list(entry["breaks"])
    for aside in pack["asides"]:
        entry = data.get(aside["audio"])
        bad = check_clip(f"aside {aside['id']}", aside["audio"], entry, [])
        problems += bad
        if not bad: aside["breaks"] = list(entry["breaks"])
    return problems


def apply(pack, pack_id):
    """Fill every sound field. Tasks that add music, effects or ambience add their step here."""
    problems = []
    problems += apply_breaks(pack, pack_id)
    return problems


def main():
    pack_id = sys.argv[1] if len(sys.argv) > 1 else "thames-loop"
    fn = os.path.join(ROOT, "public", "packs", pack_id, "pack.json")
    pack = json.load(open(fn, encoding="utf-8"))
    problems = apply(pack, pack_id)
    if problems:
        print(f"Cannot update {pack_id}: {len(problems)} problem(s). Nothing was written.", file=sys.stderr)
        for p in problems: print("  - " + p, file=sys.stderr)
        sys.exit(1)
    json.dump(pack, open(fn, "w", encoding="utf-8"), separators=(",", ":"), ensure_ascii=False)
    print("updated", os.path.relpath(fn, ROOT))


if __name__ == "__main__":
    main()
