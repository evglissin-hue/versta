"""Refresh the words of a built pack without touching its map work: python3 tools/pack_content.py <pack id>

Rewrites, in public/packs/<id>/pack.json, what the route, audio and pictures files say about the stops and stories:
stop names and notes, story titles, kinds, moods, tags and paragraphs, the recorded audio with its paragraph marks, and
the pictures. Then it fills every sound field (tools/pack_sound.py), the pack's index entry (story count and listening
minutes), the pack manifest and the places library. The line, the turn cues, the asides and the graph stay exactly as
built, so recorded cue audio stays valid.

It refuses, writing nothing, when the route file no longer matches the built pack: a stop added, removed, reordered or
moved by more than 2 m, or a changed arrival radius. Those change the line or the cues and need a full build_pack.py
run. It also refuses when a story has no recording, or a picture file is missing.

Order after changing stories: narrate_stories.py (records the changed ones), sound/find_breaks.py, then this tool.

As a module, stops_for(pack_id, stops, aud, pic_of) is the one place that turns route stops into pack stops; build_pack.py
uses it too."""
import json, math, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
CONTENT = os.path.join(ROOT, "tools", "content")
MOVE_TOL = 2.0


def stops_for(pack_id, stops, aud, pic_of):
    """The pack's stops from the route file's: ids and names as the pack shows them, notes, ambience, stories."""
    out = []
    for st in stops:
        so = {"id": st["id"], "name": st["name"], "at": [st["lng"], st["lat"]], "note": st["note"], "ambience": st["amb"],
              "arriveRadius": st.get("arrive_radius", 45), "stories": []}
        if st.get("pint"): so["pint"] = True
        for ki, story in enumerate(st["stories"]):
            key = f"{pack_id}/{st['id']}-{ki}"; a = (aud or {}).get(key); p = pic_of(key)
            o = {"id": f"{st['id']}-{ki}", "title": story["title"], "kind": story["kind"], "mood": story["mood"], "tags": story.get("tags", []), "paras": story["paras"]}
            if story.get("amb"): o["ambience"] = story["amb"]
            if a: o["audio"] = {"src": f"audio/{st['id']}-{ki}.mp3", "marks": a["marks"], "dur": a["dur"]}
            if p: o["pic"] = {"src": "img/" + p[0], "caption": p[1]}
            so["stories"].append(o)
        if st.get("pack_name"): so["name"] = st["pack_name"]
        if st.get("pack_id"):
            so["id"] = st["pack_id"]
            for o in so["stories"]: o["id"] = st["pack_id"] + o["id"][len(st["id"]):]
        out.append(so)
    return out


def metres(a, b):
    """Metres between two [lng, lat] points (equirectangular, plenty for 2 m)."""
    k = math.cos(math.radians((a[1] + b[1]) / 2))
    return math.hypot((a[0] - b[0]) * 111320 * k, (a[1] - b[1]) * 110540)


def main(argv):
    if len(argv) != 1:
        print(__doc__.split("\n\n")[0], file=sys.stderr)
        return 2
    pack_id = argv[0]
    import pack_index, pack_manifest, pack_sound, places
    assets = os.path.join(ROOT, "public", "packs", pack_id)
    fn = os.path.join(assets, "pack.json")
    problems = []
    def load(ext):
        p = os.path.join(CONTENT, f"{pack_id}.{ext}.json")
        if not os.path.exists(p): problems.append(f"missing tools/content/{pack_id}.{ext}.json"); return None
        return json.load(open(p, encoding="utf-8"))
    if not os.path.exists(fn):
        print(f"Cannot update {pack_id}: public/packs/{pack_id}/pack.json does not exist. Build it with build_pack.py.", file=sys.stderr)
        return 1
    pack = json.load(open(fn, encoding="utf-8"))
    routes, aud, pics = load("route"), load("audio"), load("pics")
    route = next((r for r in routes or [] if r.get("id") == pack_id), None)
    if route is None: problems.append(f"{pack_id}.route.json has no route with id {pack_id}")

    def pic_of(key):
        v = (pics or {}).get(key)
        if v is None: return None
        return (v[0], v[1]) if isinstance(v, list) else (v.get("file"), v.get("caption"))

    if route is not None:
        stops = route.get("stops") or []
        if len(stops) != len(pack["stops"]):
            problems.append(f"the route has {len(stops)} stops and the built pack {len(pack['stops'])}: run build_pack.py")
        for si, (st, old) in enumerate(zip(stops, pack["stops"])):
            sid = st.get("pack_id") or st.get("id")
            if sid != old["id"]: problems.append(f"stop {si} is {sid} in the route and {old['id']} in the pack: run build_pack.py")
            moved = metres([st["lng"], st["lat"]], old["at"])
            if moved > MOVE_TOL: problems.append(f"stop {si} ({sid}) has moved {moved:.0f} m: run build_pack.py")
            if st.get("arrive_radius", 45) != old["arriveRadius"]: problems.append(f"stop {si} ({sid}): the arrival radius changed: run build_pack.py")
            for ki in range(len(st.get("stories", []))):
                key = f"{pack_id}/{st['id']}-{ki}"
                if not (aud or {}).get(key): problems.append(f"story {key} has no entry in {pack_id}.audio.json (run tools/narrate_stories.py {pack_id})")
                elif not os.path.exists(os.path.join(assets, "audio", f"{st['id']}-{ki}.mp3")): problems.append(f"story {key}: public/packs/{pack_id}/audio/{st['id']}-{ki}.mp3 is missing")
                pc = pic_of(key)
                if pc and not os.path.exists(os.path.join(assets, "img", pc[0])): problems.append(f"picture {key}: public/packs/{pack_id}/img/{pc[0]} is missing")
    if not problems:
        pack["stops"] = stops_for(pack_id, route["stops"], aud, pic_of)
        pack["name"], pack["blurb"], pack["legs"] = route["name"], route["blurb"], route["legs"]
        problems += pack_sound.apply(pack, pack_id)
    if problems:
        print(f"Cannot update {pack_id}: {len(problems)} problem(s). Nothing was written.", file=sys.stderr)
        for p in problems: print("  - " + p, file=sys.stderr)
        return 1
    json.dump(pack, open(fn, "w", encoding="utf-8"), separators=(",", ":"), ensure_ascii=False)
    print("updated", os.path.relpath(fn, ROOT))
    base = os.path.join(ROOT, "public", "packs")
    ip = os.path.join(base, "index.json")
    entry = pack_index.entry_for(pack, pack_index.listening_minutes(pack, assets), route.get("card_blurb"))
    for old in json.load(open(ip, encoding="utf-8"))["packs"]:
        if old["id"] == entry["id"]: entry.update({k: old[k] for k in ("version", "bytes", "updated", "format") if k in old})
    pack_index.upsert(ip, entry)
    print("index entry", json.dumps(entry, ensure_ascii=False))
    pack_manifest.write(pack_id, base)
    places.write(base)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
