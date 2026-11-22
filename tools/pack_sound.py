"""The single place that writes sound fields into a pack.

As a module: apply(pack, pack_id) -> list of problems (empty when fine); fills story.audio.breaks, aside.breaks,
story.music, story.sfx and the stop and story ambience from the route file.
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


CATALOGUE = os.path.join(ROOT, "src", "audio", "catalogue.json")
FX_DIR = os.path.join(ROOT, "public", "sounds", "fx")
SFX_LEAD = 1.2
SFX_GAP = 10
SFX_MAX = 3


def load_route_stories(pack_id):
    """The route file's stops and stories, keyed like the pack: by pack stop id and story id."""
    fn = os.path.join(CONTENT, f"{pack_id}.route.json")
    route = next(r for r in json.load(open(fn, encoding="utf-8")) if r["id"] == pack_id)
    stops, stories = {}, {}
    for st in route["stops"]:
        sid = st.get("pack_id") or st["id"]
        stops[sid] = st
        for ki, story in enumerate(st["stories"]):
            stories[f"{sid}-{ki}"] = story
    return stops, stories


def pack_stories(pack):
    return [story for st in pack["stops"] for story in st["stories"]]


def apply_music(pack, cat, stories):
    """Copy music from the route file. Unknown name: problem. None named: warning (the app falls back to the mood)."""
    problems = []
    for story in pack_stories(pack):
        name = stories.get(story["id"], {}).get("music")
        if not name:
            print(f"warning: story {story['id']} names no music theme (the app falls back to its mood)")
            story.pop("music", None)
        elif name not in cat["music"]:
            problems.append(f"story {story['id']}: music {name!r} is not in the catalogue")
        else:
            story["music"] = name
    return problems


def apply_sfx(pack, cat, stories):
    """Copy sfx from the route file. Every rule is checked on every entry; a missing effect file is only a warning and
    leaves that entry out of the pack (rerun once the file is there)."""
    problems = []
    for story in pack_stories(pack):
        entries = stories.get(story["id"], {}).get("sfx") or []
        label = f"story {story['id']}"
        marks = (story.get("audio") or {}).get("marks", [])
        kept, places = [], []
        if len(entries) > SFX_MAX: problems.append(f"{label}: {len(entries)} effects, at most {SFX_MAX}")
        for e in entries:
            para, name = e.get("para"), e.get("name")
            ok = True
            if not isinstance(para, int) or not (0 <= para < len(story["paras"])):
                problems.append(f"{label}: effect {name!r} para {para!r} is outside the story's {len(story['paras'])} paragraphs"); ok = False
            if name not in cat["effects"]:
                problems.append(f"{label}: effect {name!r} is not in the catalogue"); ok = False
            if ok:
                if para >= len(marks):
                    problems.append(f"{label}: effect {name!r} para {para} has no paragraph mark"); ok = False
                else:
                    at = marks[para] - SFX_LEAD
                    if at < 0: problems.append(f"{label}: effect {name!r} would sound at {at:.1f} s, before the start"); ok = False
                    else: places.append((at, name))
            if ok:
                if os.path.exists(os.path.join(FX_DIR, f"{name}.mp3")): kept.append(dict(e))
                else: print(f"warning: {label}: effect {name!r} has no file public/sounds/fx/{name}.mp3, left out of the pack")
        places.sort()
        for (a, na), (b, nb) in zip(places, places[1:]):
            if b - a < SFX_GAP: problems.append(f"{label}: effects {na!r} and {nb!r} are {b - a:.1f} s apart, at least {SFX_GAP} s needed")
        if kept: story["sfx"] = kept
        else: story.pop("sfx", None)
    return problems


def apply_ambience(pack, cat, stops, stories):
    """Copy the stop and story amb from the route file into ambience."""
    problems = []
    for st in pack["stops"]:
        name = stops[st["id"]]["amb"]
        if name not in cat["soundscapes"]: problems.append(f"stop {st['id']}: soundscape {name!r} is not in the catalogue")
        else: st["ambience"] = name
        for story in st["stories"]:
            name = stories[story["id"]].get("amb")
            if name is None: story.pop("ambience", None)
            elif name not in cat["soundscapes"]: problems.append(f"story {story['id']}: soundscape {name!r} is not in the catalogue")
            else: story["ambience"] = name
    return problems


def apply(pack, pack_id):
    """Fill every sound field from the breaks file, the route file and the catalogue."""
    problems = []
    problems += apply_breaks(pack, pack_id)
    cat = json.load(open(CATALOGUE, encoding="utf-8"))
    stops, stories = load_route_stories(pack_id)
    problems += apply_music(pack, cat, stories)
    problems += apply_sfx(pack, cat, stories)
    problems += apply_ambience(pack, cat, stops, stories)
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
    import pack_manifest, places
    pack_manifest.write(pack_id, os.path.dirname(os.path.dirname(fn)))
    places.write(os.path.dirname(os.path.dirname(fn)), None if os.path.abspath(os.path.dirname(os.path.dirname(fn))) == os.path.join(ROOT, "public", "packs") else os.path.join(os.path.dirname(os.path.dirname(fn)), "places.json"))


if __name__ == "__main__":
    main()
