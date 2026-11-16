"""Build a route pack (public/packs/<id>/pack.json) from: the route content JSON, the planned GPX
tracks, cached OpenStreetMap extracts (see fetch_osm.py) and the asides JSON.
Usage: python3 tools/build_pack.py   (paths are set in the CONFIG block below)"""
import glob, json, math, re, subprocess, sys, time, os
import xml.etree.ElementTree as ET

LAT0, LON0 = 51.506, -0.045
KX = 111320 * math.cos(math.radians(LAT0)); KY = 110540
def P(lat, lon): return ((lon - LON0) * KX, (LAT0 - lat) * KY)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONTENT = os.path.join(ROOT, "tools", "content")
OSM_DIR = os.environ.get("OSM_DIR", "/home/claude/osm")
PACK_ID = "thames-loop"
routes = json.load(open(os.path.join(CONTENT, PACK_ID + ".route.json")))
stops = routes[0]["stops"]
SP = [P(s["lat"], s["lng"]) for s in stops]

def gpx(f):
    return [P(float(a), float(b)) for a, b in re.findall(r'<trkpt lat="([-\d.]+)" lon="([-\d.]+)"', open(f).read())]
OUT, BACK = gpx(os.path.join(CONTENT, PACK_ID + ".out.gpx")), gpx(os.path.join(CONTENT, PACK_ID + ".back.gpx"))

def densify(pts, step=12):
    out = [pts[0]]
    for a, b in zip(pts, pts[1:]):
        d = math.dist(a, b); n = max(1, int(d // step))
        for i in range(1, n + 1): out.append((a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n))
    return out
def split(track, sps):
    """Cut a track into pieces between consecutive stops (nearest track index, monotonic)."""
    idx, last = [], 0
    for sp in sps:
        best = min(range(last, len(track)), key=lambda i: math.dist(track[i], sp))
        idx.append(best); last = best
    idx[0] = 0; idx[-1] = len(track) - 1
    return [track[a:b + 1] for a, b in zip(idx, idx[1:])]
OUTD, BACKD = densify(OUT), densify(BACK)
segs = [[]] + split(OUTD, SP[0:6]) + [[SP[5], SP[6]]] + split(BACKD, SP[6:13])   # segs[i] leads to stop i
assert len(segs) == 13
ALL = [p for s in segs for p in s]

# spatial hash of the route for distance queries
G = 120; grid = {}
for p in ALL: grid.setdefault((int(p[0] // G), int(p[1] // G)), []).append(p)
def droute(p, cap=600):
    cx, cy = int(p[0] // G), int(p[1] // G); best = cap; r = int(cap // G) + 1
    for i in range(cx - r, cx + r + 1):
        for j in range(cy - r, cy + r + 1):
            for q in grid.get((i, j), ()):
                d = math.dist(p, q)
                if d < best: best = d
    return best

# ---------- parse OSM ----------
nodes, ways, rels = {}, {}, {}
def parse(fn):
    try:
        for ev, el in ET.iterparse(fn, events=("end",)):
            if el.tag == "node":
                nodes[el.get("id")] = P(float(el.get("lat")), float(el.get("lon"))); el.clear()
            elif el.tag == "way":
                ways[el.get("id")] = ([n.get("ref") for n in el.findall("nd")], {t.get("k"): t.get("v") for t in el.findall("tag")}); el.clear()
            elif el.tag == "relation":
                rels[el.get("id")] = ([(m.get("type"), m.get("ref"), m.get("role")) for m in el.findall("member")], {t.get("k"): t.get("v") for t in el.findall("tag")}); el.clear()
    except ET.ParseError as e:
        print("parse error", fn, e)
for fn in sorted(glob.glob(os.path.join(OSM_DIR, "cell_*.xml"))): parse(fn)
print("nodes", len(nodes), "ways", len(ways), "rels", len(rels), flush=True)

def is_water(t):
    return t.get("natural") == "water" or t.get("waterway") in ("riverbank", "dock") or t.get("landuse") in ("basin", "reservoir")
# complete the water multipolygons
UA = "StoriedRoutes/0.1 (personal non-commercial project)"
for rid, (mem, tags) in list(rels.items()):
    if tags.get("type") == "multipolygon" and is_water(tags):
        if any(m[0] == "way" and m[1] not in ways for m in mem):
            fn = os.path.join(OSM_DIR, f"rel_{rid}.xml")
            if not os.path.exists(fn) or os.path.getsize(fn) < 300:
                subprocess.run(["curl", "-s", "--max-time", "120", "--compressed", "-A", UA, "-o", fn, f"https://api.openstreetmap.org/api/0.6/relation/{rid}/full"]); time.sleep(0.8)
            parse(fn)
print("after relations: nodes", len(nodes), "ways", len(ways), flush=True)

def coords(nds): return [nodes[n] for n in nds if n in nodes]
def rdp(pts, eps):
    if len(pts) < 3: return pts
    keep = [False] * len(pts); keep[0] = keep[-1] = True; st = [(0, len(pts) - 1)]
    while st:
        a, b = st.pop(); ax, ay = pts[a]; bx, by = pts[b]; dx, dy = bx - ax, by - ay; L = math.hypot(dx, dy) or 1e-9
        md, mi = 0, -1
        for i in range(a + 1, b):
            d = abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L if L > 1e-6 else math.dist(pts[i], pts[a])
            if d > md: md, mi = d, i
        if md > eps: keep[mi] = True; st += [(a, mi), (mi, b)]
    return [p for p, k in zip(pts, keep) if k]
def flat(pts): return [int(round(v)) for p in pts for v in p]
def area(pts): return abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(pts, pts[1:] + pts[:1]))) / 2

xs = [p[0] for p in ALL]; ys = [p[1] for p in ALL]
BOX = (min(xs) - 420, min(ys) - 420, max(xs) + 420, max(ys) + 420)
def clip(poly, box):
    x0, y0, x1, y1 = box
    def cut(pts, inside, inter):
        out = []
        for a, b in zip(pts, pts[1:] + pts[:1]):
            ia, ib = inside(a), inside(b)
            if ia and ib: out.append(b)
            elif ia and not ib: out.append(inter(a, b))
            elif not ia and ib: out += [inter(a, b), b]
        return out
    def ix(x): return lambda a, b: (x, a[1] + (b[1] - a[1]) * (x - a[0]) / ((b[0] - a[0]) or 1e-9))
    def iy(y): return lambda a, b: (a[0] + (b[0] - a[0]) * (y - a[1]) / ((b[1] - a[1]) or 1e-9), y)
    for inside, inter in ((lambda p: p[0] >= x0, ix(x0)), (lambda p: p[0] <= x1, ix(x1)), (lambda p: p[1] >= y0, iy(y0)), (lambda p: p[1] <= y1, iy(y1))):
        if not poly: break
        poly = cut(poly, inside, inter)
    return poly

def rings(member_ways):
    """Join ways end to end into closed rings."""
    pool = [list(ways[w][0]) for w in member_ways if w in ways and len(ways[w][0]) > 1]; out = []
    while pool:
        r = pool.pop()
        while r[0] != r[-1]:
            for i, w in enumerate(pool):
                if w[0] == r[-1]: r += w[1:]; pool.pop(i); break
                if w[-1] == r[-1]: r += w[-2::-1]; pool.pop(i); break
            else: break
        if r[0] == r[-1] and len(r) > 3: out.append(r)
    return out

water = []
used = set()
for rid, (mem, tags) in rels.items():
    if tags.get("type") == "multipolygon" and is_water(tags):
        for role in ("outer", "inner"):
            mw = [m[1] for m in mem if m[0] == "way" and ((m[2] or "outer") == role)]
            used.update(mw)
            for r in rings(mw):
                c = clip(coords(r[:-1]), BOX)
                if len(c) > 2 and area(c) > 400: water.append((role, rdp(c + [c[0]], 4)[:-1]))
for wid, (nds, tags) in ways.items():
    if wid in used: continue
    if is_water(tags) and len(nds) > 3 and nds[0] == nds[-1]:
        c = clip(coords(nds[:-1]), BOX)
        if len(c) > 2 and area(c) > 600: water.append(("outer", rdp(c + [c[0]], 3)[:-1]))
print("water rings", len(water), flush=True)

parks = []
for wid, (nds, tags) in ways.items():
    if tags.get("leisure") in ("park", "garden") and len(nds) > 3 and nds[0] == nds[-1]:
        c = coords(nds[:-1])
        if len(c) > 2 and area(c) > 6000 and min(droute(p, 500) for p in c[::3]) < 450:
            c = clip(c, BOX)
            if len(c) > 2: parks.append(rdp(c + [c[0]], 5)[:-1])
print("parks", len(parks), flush=True)

C1 = {"motorway", "trunk", "primary", "secondary", "tertiary", "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link"}
C2 = {"residential", "unclassified", "living_street", "pedestrian", "road"}
C3 = {"cycleway", "path", "footway", "track", "bridleway", "steps"}
roads = []; named = []   # named: (name, kind, pts) for matching
for wid, (nds, tags) in ways.items():
    h = tags.get("highway")
    if not h: continue
    cls = 1 if h in C1 else 2 if h in C2 else 3 if h in C3 else 2 if h == "service" and tags.get("name") else 0
    if not cls: continue
    if tags.get("tunnel") in ("yes", "building_passage") and cls == 1: pass
    pts = coords(nds)
    if len(pts) < 2: continue
    lim = {1: 520, 2: 300, 3: 70}[cls]
    run = []
    for p in pts + [None]:
        if p is not None and droute(p, lim + 50) <= lim: run.append(p)
        else:
            if len(run) > 1: roads.append((cls, rdp(run, 2.5)))
            run = []
    if cls != 3 or tags.get("name") or True:
        named.append((tags.get("name") or "", h, tags, pts))
print("roads", len(roads), "points", sum(len(r[1]) for r in roads), flush=True)

# ---------- cue sheets: which street is the route on ----------
SG = 60; sgrid = {}
for ni, (name, h, tags, pts) in enumerate(named):
    for a, b in zip(pts, pts[1:]):
        n = max(1, int(math.dist(a, b) // 30))
        for i in range(n + 1):
            x = a[0] + (b[0] - a[0]) * i / n; y = a[1] + (b[1] - a[1]) * i / n
            sgrid.setdefault((int(x // SG), int(y // SG)), set()).add((ni, a, b))
def segdist(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]; L2 = dx * dx + dy * dy or 1e-9
    t = max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2))
    return math.dist(p, (a[0] + dx * t, a[1] + dy * t))
def bearing(a, b): return math.atan2(b[0] - a[0], -(b[1] - a[1]))
def angdiff(a, b):
    d = abs(a - b) % math.pi
    return min(d, math.pi - d)
def kindname(h, tags):
    if h == "steps": return "steps (carry the bike)"
    if h in ("footway", "pedestrian"): return "footpath (walk the bike)" if tags.get("bicycle") in (None, "no", "dismount") else "shared path"
    if h in ("cycleway",): return "cycle path"
    if h in ("path", "track", "bridleway"): return "path"
    return "unnamed road"
def match(p, tb):
    cx, cy = int(p[0] // SG), int(p[1] // SG); best = (1e9, None)
    for i in (cx - 1, cx, cx + 1):
        for j in (cy - 1, cy, cy + 1):
            for ni, a, b in sgrid.get((i, j), ()):
                d = segdist(p, a, b)
                if d > 22: continue
                pen = d + (0 if angdiff(bearing(a, b), tb) < 0.6 else 25) + (0 if named[ni][0] else 6)
                if pen < best[0]: best = (pen, ni)
    if best[1] is None: return "path"
    name, h, tags, _ = named[best[1]]
    return name or kindname(h, tags)

def LL(p): return [round(LON0 + p[0] / KX, 6), round(LAT0 - p[1] / KY, 6)]
def kind_of(name):
    if name.startswith("steps"): return "steps"
    if name.startswith("footpath"): return "footpath"
    if name in ("cycle path", "shared path"): return "cycle_path"
    if name in ("path", "unnamed road"): return "path"
    return "road"
def phrase(turn, name, kind):
    verb = {"left": "Turn left", "right": "Turn right", "slight_left": "Bear left", "slight_right": "Bear right",
            "sharp_left": "Sharp left", "sharp_right": "Sharp right", "straight": "Continue", "depart": "Head along"}[turn]
    if kind == "road": return f"{verb} onto {name}." if turn != "depart" else f"Head along {name}."
    what = {"cycle_path": "the cycle path", "footpath": "the footpath. Walk the bike", "steps": "the steps. Carry the bike", "path": "the path"}[kind]
    return f"{verb} onto {what}." if turn != "depart" else f"Head along {what}."

seg_tracks, cues = [[]], []
for si in range(1, 13):
    s = segs[si]
    if si == 6:
        seg_tracks.append([LL(SP[5]), LL(SP[6])])
        cues.append({"seg": 6, "i": 0, "at": LL(SP[5]), "turn": "depart", "name": "Greenwich Foot Tunnel", "kind": "footpath", "len": 370,
                     "say": "Take the lift or stairs down into the Greenwich Foot Tunnel. Walk the bike through."})
        continue
    labs = []
    for i, p in enumerate(s):
        a = s[max(0, i - 2)]; b = s[min(len(s) - 1, i + 2)]
        labs.append(match(p, bearing(a, b)))
    runs = []
    for i, n in enumerate(labs):
        if runs and runs[-1][0] == n: runs[-1][2] = i
        else: runs.append([n, i, i])
    def length(r): return sum(math.dist(s[k], s[k + 1]) for k in range(r[1], min(r[2] + 1, len(s) - 1)))
    changed = True
    while changed and len(runs) > 1:
        changed = False
        for k, r in enumerate(runs):
            if length(r) < 45:
                if k > 0: runs[k - 1][2] = r[2]
                else: runs[k + 1][1] = r[1]
                runs.pop(k); changed = True; break
        merged = []
        for r in runs:
            if merged and merged[-1][0] == r[0]: merged[-1][2] = r[2]
            else: merged.append(r)
        if len(merged) != len(runs): changed = True
        runs = merged
    # simplify each run on its own so every manoeuvre point survives as a vertex
    track, starts = [], []
    for r in runs:
        piece = rdp(s[r[1]:r[2] + 2], 2.0) if r[2] + 2 <= len(s) else rdp(s[r[1]:], 2.0)
        starts.append(len(track) - (1 if track else 0))
        track += piece if not track else piece[1:]
    seg_tracks.append([LL(p) for p in track])
    for k, r in enumerate(runs):
        i0 = r[1]; turn = "depart"
        if k > 0:
            b1 = bearing(s[max(0, i0 - 4)], s[i0]); b2 = bearing(s[i0], s[min(len(s) - 1, i0 + 4)])
            d = math.degrees((b2 - b1 + math.pi) % (2 * math.pi) - math.pi); ad = abs(d); side = "right" if d > 0 else "left"
            turn = "straight" if ad < 25 else ("slight_" + side) if ad < 55 else side if ad < 135 else ("sharp_" + side)
        kd = kind_of(r[0]); ln = int(round(length(r) / 10) * 10)
        c = {"seg": si, "i": max(0, starts[k]), "at": LL(s[i0]), "turn": turn, "name": r[0] if kd == "road" else {"cycle_path": "cycle path", "footpath": "footpath", "steps": "steps", "path": "path"}[kd],
             "kind": kd, "len": ln, "say": phrase(turn, r[0], kd)}
        if turn == "straight" and ln < 120: c["quiet"] = True
        cues.append(c)

# asides: anchored to a named stretch of a segment so they always sit on the real line
asides = []
for a in json.load(open(os.path.join(CONTENT, PACK_ID + ".asides.json"))):
    cs = [c for c in cues if c["seg"] == a["seg"] and c["name"] == a["street"]]
    if not cs: print("ASIDE NOT ANCHORED", a["id"], a["street"]); continue
    c = max(cs, key=lambda c: c["len"]); t = seg_tracks[a["seg"]]
    # walk along the track from the cue start for frac * len metres
    def M(ll): return P(ll[1], ll[0])
    want = a["frac"] * c["len"]; i = c["i"]; acc = 0; at = t[i]
    while i < len(t) - 1 and acc < want:
        step = math.dist(M(t[i]), M(t[i + 1]))
        if acc + step >= want:
            f = (want - acc) / (step or 1); at = [round(t[i][0] + (t[i + 1][0] - t[i][0]) * f, 6), round(t[i][1] + (t[i + 1][1] - t[i][1]) * f, 6)]; break
        acc += step; i += 1; at = t[i]
    asides.append({"id": a["id"], "seg": a["seg"], "at": at, "title": a["title"], "tags": a["tags"], "text": a["text"], "audio": f"asides/{a['id']}.mp3"})

route = routes[0]; aud = json.load(open(os.path.join(CONTENT, PACK_ID + ".audio.json")))
pics = json.load(open(os.path.join(CONTENT, PACK_ID + ".pics.json")))
stops_out = []
for si, st in enumerate(stops):
    so = {"id": st["id"], "name": st["name"], "at": [st["lng"], st["lat"]], "note": st["note"], "ambience": st["amb"], "arriveRadius": 45, "stories": []}
    if st.get("pint"): so["pint"] = True
    for ki, story in enumerate(st["stories"]):
        key = f"{PACK_ID}/{st['id']}-{ki}"; a = aud.get(key); p = pics.get(key)
        o = {"id": f"{st['id']}-{ki}", "title": story["title"], "kind": story["kind"], "mood": story["mood"], "tags": story.get("tags", []), "paras": story["paras"]}
        if story.get("amb"): o["ambience"] = story["amb"]
        if a: o["audio"] = {"src": f"audio/{st['id']}-{ki}.mp3", "marks": a["marks"], "dur": a["dur"]}
        if p: o["pic"] = {"src": "img/" + p[0], "caption": p[1]}
        so["stories"].append(o)
    stops_out.append(so)
stops_out[-1]["name"] = "Wenlock Basin"; stops_out[-1]["id"] = "wenlock-basin"
for o in stops_out[-1]["stories"]: o["id"] = o["id"].replace("home-", "wenlock-basin-")
for c in cues: c["id"] = f"s{c['seg']:02d}-{c['i']:03d}"; c["audio"] = f"cues/{c['id']}.mp3"
pack = {"format": 1, "id": PACK_ID, "name": route["name"], "mode": route["mode"], "km": route["km"], "blurb": route["blurb"],
        "hero": {"src": "img/" + pics[PACK_ID][0], "caption": pics[PACK_ID][1]},
        "legs": route["legs"], "stops": stops_out, "segments": seg_tracks, "cues": cues, "asides": asides,
        "system": {"arrive": [f"system/arrive-{s['id']}.mp3" for s in stops_out], "offRoute": "system/off-route.mp3", "backOnRoute": "system/back-on-route.mp3"},
        "credits": ["Pictures are public domain works from Wikimedia Commons.", "Map data © OpenStreetMap contributors."]}
out = os.path.join(ROOT, "public", "packs", PACK_ID, "pack.json")
json.dump(pack, open(out, "w"), separators=(",", ":"), ensure_ascii=False)
print("pack bytes", os.path.getsize(out), "| cues", len(cues), "spoken", sum(1 for c in cues if not c.get("quiet")), "| asides", len(asides), "| track pts", sum(len(t) for t in seg_tracks))
for c in cues: print(c["id"], c["say"], c["len"], "(quiet)" if c.get("quiet") else "")
