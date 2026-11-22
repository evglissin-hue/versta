"""The places library: python3 tools/places.py
Writes public/places.json from every pack in public/packs/index.json, in index order: one place per stop that has
recorded stories and one per passing-by story. Never edit it by hand."""
import hashlib, json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pack_index

PACKS = os.path.join(ROOT, "public", "packs")
ASIDE_RADIUS = 60


def places_of(pack, pack_dir):
    out = []
    for st in pack["stops"]:
        stories = []
        for s in st["stories"]:
            if not s.get("audio"): continue
            o = {"id": s["id"], "title": s["title"], "kind": s["kind"], "audio": s["audio"]["src"], "dur": s["audio"]["dur"]}
            if s.get("pic"): o["pic"] = s["pic"]["src"]
            stories.append(o)
        if stories:
            out.append({"id": f"{pack['id']}:{st['id']}", "name": st["name"], "at": st["at"], "radius": st["arriveRadius"],
                        "pack": pack["id"], "kind": "stop", "stories": stories})
    for a in pack["asides"]:
        if not a.get("audio"): continue
        name = a.get("title") or a.get("name")
        d = pack_index.duration(os.path.join(pack_dir, a["audio"]))
        out.append({"id": f"{pack['id']}:{a['id']}", "name": name, "at": a["at"], "radius": ASIDE_RADIUS, "pack": pack["id"],
                    "kind": "aside", "stories": [{"id": a["id"], "title": name, "kind": "aside", "audio": a["audio"], "dur": round(d, 2) if d is not None else 0}]})
    return out


def plain(v):
    """Whole-number floats as ints, so the text is the same as JavaScript writes it (12.0 is 12)."""
    if isinstance(v, float) and v == int(v): return int(v)
    if isinstance(v, list): return [plain(x) for x in v]
    if isinstance(v, dict): return {k: plain(x) for k, x in v.items()}
    return v


def digest(places):
    text = json.dumps({"places": plain(places)}, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def write(base=PACKS, out=None):
    out = out or os.path.join(ROOT, "public", "places.json")
    places = []
    for e in json.load(open(os.path.join(base, "index.json"), encoding="utf-8"))["packs"]:
        pack = json.load(open(os.path.join(base, e["id"], "pack.json"), encoding="utf-8"))
        places += places_of(pack, os.path.join(base, e["id"]))
    body = ",\n".join(" " + json.dumps(p, separators=(",", ":"), ensure_ascii=False) for p in places)
    ver = digest(places)
    with open(out, "w", encoding="utf-8") as fh:
        fh.write('{"version":"%s","places":[\n%s\n]}\n' % (ver, body))
    print(f"places: {len(places)} ({sum(1 for p in places if p['kind'] == 'stop')} stops, {sum(1 for p in places if p['kind'] == 'aside')} asides), version {ver}")


if __name__ == "__main__":
    write()
