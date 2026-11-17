"""The route index (public/packs/index.json): one entry per pack, in pack order. Used by build_pack.py and narrate.py.
listening_minutes counts the recorded stories and passing-by stories. A passing-by story not yet recorded is estimated
from its words, so the figure is right once narrate.py has run (it calls update_minutes at the end)."""
import json, os, subprocess

ASIDE_WORDS_PER_MIN = 148   # measured on the Thames Loop asides at the story speed
FIELDS = ("id", "name", "mode", "km", "stops", "hero", "blurb", "stories", "asides", "minutes")


def duration(path):
    """Seconds of an audio file, by ffprobe, or None when it is missing or unreadable."""
    if not os.path.exists(path): return None
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], capture_output=True, text=True)
    try: return float(r.stdout.strip())
    except ValueError: return None


def listening_minutes(pack, pack_dir):
    """Minutes of stories and passing-by stories in a pack. pack_dir holds its audio/ and asides/ folders."""
    secs = sum(st["audio"]["dur"] for s in pack["stops"] for st in s["stories"] if st.get("audio"))
    for a in pack["asides"]:
        d = duration(os.path.join(pack_dir, a["audio"]))
        secs += d if d is not None else len(a["text"].split()) / ASIDE_WORDS_PER_MIN * 60
    return round(secs / 60)


def entry_for(pack, minutes, card_blurb=None):
    """The index entry for a built pack. card_blurb is the shorter blurb for the Home card, when the route has one."""
    return {"id": pack["id"], "name": pack["name"], "mode": pack["mode"], "km": pack["km"], "stops": len(pack["stops"]),
            "hero": f"packs/{pack['id']}/{pack['hero']['src']}", "blurb": card_blurb or pack["blurb"],
            "stories": sum(len(s["stories"]) for s in pack["stops"]), "asides": len(pack["asides"]), "minutes": minutes}


def upsert(index_path, entry):
    """Replace the entry with the same id in place, keeping pack order, or add it at the end."""
    idx = json.load(open(index_path)) if os.path.exists(index_path) else {"packs": []}
    for i, e in enumerate(idx["packs"]):
        if e["id"] == entry["id"]: idx["packs"][i] = entry; break
    else: idx["packs"].append(entry)
    json.dump(idx, open(index_path, "w"), separators=(",", ":"), ensure_ascii=False)
    return idx


def update_minutes(index_path, pack, pack_dir):
    """After recording: set the listening minutes of a pack that is already in the index."""
    if not os.path.exists(index_path): return None
    idx = json.load(open(index_path))
    for e in idx["packs"]:
        if e["id"] == pack["id"]:
            e["minutes"] = listening_minutes(pack, pack_dir)
            json.dump(idx, open(index_path, "w"), separators=(",", ":"), ensure_ascii=False)
            return e["minutes"]
    return None
