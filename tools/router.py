"""A bike router over OpenStreetMap extracts, and the corridor graph writer.

Reads the cached extracts (cell_*.xml, rel_*.xml in OSM_DIR, see fetch_osm.py), builds a routing graph
and finds comfortable bike lines through via points. Cost per metre (lower is better):
  cycleways 0.6, ways of a bicycle route relation 0.6 (main roads 0.55 of their own cost),
  shared footways and paths where bikes are allowed 0.7, living streets and pedestrian areas 0.8,
  quiet residential and unclassified streets 1.0, service roads 1.1, tertiary 1.6, secondary 2.5, primary 4,
  walking sections (footways and paths with no cycling permission, bicycle=dismount) 5, steps 20.
  Cycle lanes and tracks on a road take 0.9 and 0.8 off it. Everything within 60 m of the Thames or a dock x 0.8.
  Out: motorways, trunk roads without cycle provision, bicycle=no|private, access=private|no.
  One-way streets are respected unless oneway:bicycle=no or a contraflow cycle lane.
Turns cost something too (a bend 3, a right angle 8, a near U-turn 20, a name change 3) so lines do not zigzag.

Usage as a module: net = router.load(); path = net.route([(lng, lat), ...]); net.profile(line)."""
import glob, heapq, json, math, os, pickle, subprocess, sys, time
import xml.etree.ElementTree as ET

LAT0, LON0 = 51.506, -0.045
KX = 111320 * math.cos(math.radians(LAT0)); KY = 110540
def P(lat, lon): return ((lon - LON0) * KX, (LAT0 - lat) * KY)
def LL(p): return [round(LON0 + p[0] / KX, 7), round(LAT0 - p[1] / KY, 7)]
def PLL(ll): return P(ll[1], ll[0])
OSM_DIR = os.environ.get("OSM_DIR", "/home/claude/osm")
UA = "VerstaRoutePlanner/0.2 (personal non-commercial hobby project)"

KINDS = ["road", "cycle_path", "footpath", "steps", "path"]
F_CYC, F_WALK, F_MAIN, F_STEPS = 1, 2, 4, 8     # per-way flags used for profiles
CYCLE_LANE = {"lane", "track", "shared_lane", "share_busway", "opposite_lane", "opposite_track"}
UNPAVED = {"unpaved", "dirt", "grass", "ground", "mud", "sand", "earth", "grass_paver"}
LOOSE = {"gravel", "fine_gravel", "compacted", "pebblestone"}
ROAD_COST = {"residential": 1.0, "unclassified": 1.0, "road": 1.0, "living_street": 0.8, "service": 1.1, "track": 1.3,
             "tertiary": 1.6, "tertiary_link": 1.6, "secondary": 2.5, "secondary_link": 2.5,
             "primary": 4.0, "primary_link": 4.0, "trunk": 4.0, "trunk_link": 4.0}
MAIN = {"primary", "primary_link", "secondary", "secondary_link", "trunk", "trunk_link"}

def way_info(wid, tags, cycrel):
    """(factor, kind index, flags, oneway) for a way a bike may use, else None. oneway: 0 both, 1 forward, -1 backward."""
    h = tags.get("highway")
    if not h or tags.get("area") == "yes": return None
    bic = tags.get("bicycle"); acc = tags.get("access")
    permit = bic in ("yes", "designated", "permissive") or h == "cycleway"
    if bic in ("no", "private", "use_sidepath"): return None
    if acc in ("private", "no", "customers", "permit", "delivery") and not permit: return None
    if tags.get("vehicle") in ("no", "private") and not permit: return None
    if tags.get("motorroad") == "yes": return None
    if h == "service" and tags.get("service") == "driveway" and not permit: return None
    lane = [tags.get(k) for k in ("cycleway", "cycleway:left", "cycleway:right", "cycleway:both")]
    has_track = any(v == "track" or v == "opposite_track" for v in lane); has_lane = any(v in CYCLE_LANE for v in lane)
    incyc = wid in cycrel
    flags = 0
    if h in ("motorway", "motorway_link"): return None
    if h in ("trunk", "trunk_link") and not (has_track or has_lane or permit): return None
    if h in ROAD_COST:
        f = ROAD_COST[h]; kind = 0
        if h == "service" and tags.get("service") in ("parking_aisle",): f = 1.5
        if h in MAIN: flags |= F_MAIN
        if incyc: f = max(0.6, f * 0.55) if f > 1.0 else min(f, 0.6); flags |= F_CYC
        if has_track: f *= 0.8
        elif has_lane: f *= 0.9
    elif h == "cycleway": f = 0.6; kind = 1; flags |= F_CYC
    elif h in ("footway", "pedestrian", "path", "bridleway", "steps"):
        if h == "steps":
            f = 20.0; kind = 3; flags |= F_WALK | F_STEPS
            if bic in ("yes", "designated"): f = 4.0
        elif h == "bridleway": f = 1.2; kind = 4
        elif permit or incyc:
            f = 0.8 if h == "pedestrian" else 0.7; kind = 4 if h == "path" else 1
            if h == "pedestrian" and tags.get("name"): kind = 0
            if incyc: f = 0.6; flags |= F_CYC
        elif h == "pedestrian" and bic != "dismount" and tags.get("foot") is None and False: f = 0.8; kind = 0
        else: f = 5.0; kind = 2; flags |= F_WALK
    else: return None
    s = tags.get("surface")
    if s in UNPAVED: f *= 1.5
    elif s in LOOSE: f *= 1.1
    elif s in ("cobblestone", "sett", "unhewn_cobblestone"): f *= 1.2
    ow = 0
    ov = tags.get("oneway"); obic = tags.get("oneway:bicycle")
    if ov in ("yes", "true", "1") or tags.get("junction") == "roundabout": ow = 1
    elif ov == "-1": ow = -1
    if h in ("footway", "pedestrian", "steps") and ov is None: ow = 0
    if obic == "no": ow = 0
    elif obic in ("yes", "true", "1"): ow = 1
    elif obic == "-1": ow = -1
    if any(v and v.startswith("opposite") for v in lane): ow = 0
    return f, kind, flags, ow

class Net: pass

def _parse(fn, nodes, ways, rels):
    try:
        for ev, el in ET.iterparse(fn, events=("end",)):
            if el.tag == "node": nodes[el.get("id")] = P(float(el.get("lat")), float(el.get("lon"))); el.clear()
            elif el.tag == "way": ways[el.get("id")] = ([n.get("ref") for n in el.findall("nd")], {t.get("k"): t.get("v") for t in el.findall("tag")}); el.clear()
            elif el.tag == "relation":
                tg = {t.get("k"): t.get("v") for t in el.findall("tag")}
                if tg.get("type") == "multipolygon" or tg.get("route") == "bicycle":
                    rels[el.get("id")] = ([(m.get("type"), m.get("ref"), m.get("role")) for m in el.findall("member")], tg)
                el.clear()
    except ET.ParseError as e: print("parse error", fn, e)

def is_water(t):
    return t.get("natural") == "water" or t.get("waterway") in ("riverbank", "dock") or t.get("landuse") in ("basin", "reservoir")

def rings(ways, member_ways):
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
def area(pts): return abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(pts, pts[1:] + pts[:1]))) / 2

def _rdp(pts, eps):
    if len(pts) < 3: return pts
    keep = [False] * len(pts); keep[0] = keep[-1] = True; st = [(0, len(pts) - 1)]
    while st:
        a, b = st.pop(); ax, ay = pts[a]; bx, by = pts[b]; dx, dy = bx - ax, by - ay; L = math.hypot(dx, dy)
        md, mi = 0, -1
        for i in range(a + 1, b):
            d = abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L if L > 1e-6 else math.dist(pts[i], pts[a])
            if d > md: md, mi = d, i
        if md > eps: keep[mi] = True; st += [(a, mi), (mi, b)]
    return [p for p, k in zip(pts, keep) if k]

def load(osm_dir=OSM_DIR, box=None, cache=True):
    """Parse the extracts and build the routing graph. box = (x0, y0, x1, y1) in local metres limits where water is sampled."""
    cells = sorted(glob.glob(os.path.join(osm_dir, "cell_*.xml")))
    key = (len(cells), max(os.path.getmtime(c) for c in cells), box)
    pk = "/tmp/versta_net_cache.pkl"
    if cache and os.path.exists(pk):
        try:
            k, net = pickle.load(open(pk, "rb"))
            if k == key: return net
        except Exception: pass
    nodes, ways, rels = {}, {}, {}
    for fn in cells: _parse(fn, nodes, ways, rels)
    for rid, (mem, tags) in list(rels.items()):
        if tags.get("type") == "multipolygon" and is_water(tags) and any(m[0] == "way" and m[1] not in ways for m in mem):
            fn = os.path.join(osm_dir, f"rel_{rid}.xml")
            if not os.path.exists(fn) or os.path.getsize(fn) < 300:
                subprocess.run(["curl", "-s", "--max-time", "120", "--compressed", "-A", UA, "-o", fn, f"https://api.openstreetmap.org/api/0.6/relation/{rid}/full"]); time.sleep(0.8)
            _parse(fn, nodes, ways, rels)
    print("parsed nodes", len(nodes), "ways", len(ways), "rels", len(rels), flush=True)
    net = Net()
    cycrel = set()
    for rid, (mem, tags) in rels.items():
        if tags.get("route") == "bicycle": cycrel.update(m[1] for m in mem if m[0] == "way")
    # water edge samples near the box
    wpts = []; used = set()
    wring = []
    for rid, (mem, tags) in rels.items():
        if tags.get("type") == "multipolygon" and is_water(tags):
            for role in ("outer", "inner"):
                mw = [m[1] for m in mem if m[0] == "way" and (m[2] or "outer") == role]; used.update(mw)
                wring += [(role, r) for r in rings(ways, mw)]
    for wid, (nds, tags) in ways.items():
        if wid not in used and is_water(tags) and len(nds) > 3 and nds[0] == nds[-1]: wring.append(("outer", nds))
    net.water = []
    for role, r in wring:
        pts = [nodes[n] for n in r if n in nodes]
        if len(pts) < 4 or area(pts[:-1]) < 15000: continue
        net.water.append((role, _rdp(pts, 3.0)))
        for a, b in zip(pts, pts[1:]):
            if box and not (box[0] < a[0] < box[2] and box[1] < a[1] < box[3]): continue
            n = max(1, int(math.dist(a, b) // 8))
            for i in range(n): wpts.append((a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n))
    WG = 60; wgrid = {}
    for p in wpts: wgrid.setdefault((int(p[0] // WG), int(p[1] // WG)), []).append(p)
    def near_water(p):
        cx, cy = int(p[0] // WG), int(p[1] // WG)
        for i in (cx - 1, cx, cx + 1):
            for j in (cy - 1, cy, cy + 1):
                for q in wgrid.get((i, j), ()):
                    if (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 <= 3600: return True
        return False
    print("water samples", len(wpts), flush=True)
    names = [""]; nameix = {"": 0}
    nid = {}; npos = []
    def node(n):
        i = nid.get(n)
        if i is None: i = nid[n] = len(npos); npos.append(nodes[n])
        return i
    # undirected edges
    eu, ev, elen, ecost, ename, ekind, eflag, eow, ewid = [], [], [], [], [], [], [], [], []
    for wid, (nds, tags) in ways.items():
        inf = way_info(wid, tags, cycrel)
        if not inf: continue
        f, kind, flags, ow = inf
        nm = tags.get("name") or ""
        if nm not in nameix: nameix[nm] = len(names); names.append(nm)
        nn = [n for n in nds if n in nodes]
        for a, b in zip(nn, nn[1:]):
            if a == b: continue
            pa, pb = nodes[a], nodes[b]; L = math.dist(pa, pb)
            if L < 0.01: continue
            mid = ((pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2)
            c = L * f * (0.8 if near_water(mid) else 1.0)
            eu.append(node(a)); ev.append(node(b)); elen.append(L); ecost.append(c); ename.append(nameix[nm]); ekind.append(kind); eflag.append(flags); eow.append(ow); ewid.append(wid)
    net.names, net.npos = names, npos
    net.eu, net.ev, net.elen, net.ecost, net.ename, net.ekind, net.eflag, net.eow, net.ewid = eu, ev, elen, ecost, ename, ekind, eflag, eow, ewid
    # directed edges: de = 2*e (u->v), 2*e+1 (v->u); allowed per oneway
    nn_ = len(npos); out = [[] for _ in range(nn_)]
    for e in range(len(eu)):
        ow = eow[e]
        if ow >= 0: out[eu[e]].append(2 * e)
        if ow <= 0: out[ev[e]].append(2 * e + 1)
    net.out = out
    net.nodeedges = None
    print("router graph: nodes", nn_, "edges", len(eu), flush=True)
    if cache: pickle.dump((key, net), open(pk, "wb"), protocol=4)
    return net

def _dfrom(net, d): return net.eu[d >> 1] if d % 2 == 0 else net.ev[d >> 1]
def _dto(net, d): return net.ev[d >> 1] if d % 2 == 0 else net.eu[d >> 1]
def _bearing(net, d):
    a = net.npos[_dfrom(net, d)]; b = net.npos[_dto(net, d)]
    return math.atan2(b[0] - a[0], -(b[1] - a[1]))

def _turn_cost(net, prev, d):
    if prev is None: return 0.0
    if prev ^ 1 == d: return 400.0
    t = abs(math.degrees(_bearing(net, d) - _bearing(net, prev))) % 360
    if t > 180: t = 360 - t
    c = 0.0 if t < 35 else 3.0 if t < 75 else 8.0 if t < 125 else 20.0
    if net.ename[prev >> 1] != net.ename[d >> 1] or net.ename[d >> 1] == 0: c += 3.0
    return c

def snap(net, ll, radius=200, proper=True):
    """Nearest node (by metres) of a rideable way; prefers ways that are not walking sections or steps."""
    p = PLL(ll)
    if getattr(net, "ngrid", None) is None:
        g = {}; gp = {}
        for e in range(len(net.eu)):
            for n in (net.eu[e], net.ev[e]):
                q = net.npos[n]; k = (int(q[0] // 100), int(q[1] // 100))
                g.setdefault(k, set()).add(n)
                if not net.eflag[e] & F_WALK: gp.setdefault(k, set()).add(n)
        net.ngrid, net.ngrid_proper = g, gp
    best, bn = radius * radius + 1, None
    for gr in ((net.ngrid_proper, net.ngrid) if proper else (net.ngrid,)):
        cx, cy = int(p[0] // 100), int(p[1] // 100); r = int(radius // 100) + 1
        for i in range(cx - r, cx + r + 1):
            for j in range(cy - r, cy + r + 1):
                for n in gr.get((i, j), ()):
                    q = net.npos[n]; dd = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2
                    if dd < best: best, bn = dd, n
        if bn is not None: break
    return bn

def astar(net, s, targets, prev=None, hmin=0.3, aim=None, aim_r=0.0):
    """Cheapest path from node s to any node in `targets` (a node or a set of nodes). Returns (directed edge list, cost) or None."""
    if not isinstance(targets, (set, frozenset)): targets = {targets}
    if aim is None: aim = net.npos[next(iter(targets))]
    def h(n):
        q = net.npos[n]; return hmin * max(0.0, math.hypot(q[0] - aim[0], q[1] - aim[1]) - aim_r)
    best = {}; parent = {}; heap = []
    for d in net.out[s]:
        c = net.ecost[d >> 1] + _turn_cost(net, prev, d)
        if c < best.get(d, 1e18): best[d] = c; parent[d] = None; heapq.heappush(heap, (c + h(_dto(net, d)), c, d))
    while heap:
        f, g, d = heapq.heappop(heap)
        if g > best.get(d, 1e18): continue
        v = _dto(net, d)
        if v in targets:
            path = []; x = d
            while x is not None: path.append(x); x = parent[x]
            return path[::-1], g
        for d2 in net.out[v]:
            c = g + net.ecost[d2 >> 1] + _turn_cost(net, d, d2)
            if c < best.get(d2, 1e18): best[d2] = c; parent[d2] = d; heapq.heappush(heap, (c + h(_dto(net, d2)), c, d2))
    return None

def gate(net, ll, r=60):
    """Nodes of ridable (not walking) ways within r metres of a via point, or None."""
    p = PLL(ll); snap(net, ll, 50)   # makes sure the node grid exists
    out = set(); cx, cy = int(p[0] // 100), int(p[1] // 100)
    for i in (cx - 1, cx, cx + 1):
        for j in (cy - 1, cy, cy + 1):
            for n in net.ngrid_proper.get((i, j), ()):
                q = net.npos[n]
                if (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 <= r * r and net.out[n]: out.add(n)
    return out or None

def route(net, lls, radius=200, gate_r=60):
    """Route through the lng/lat points in order. The first and last are snapped to the nearest node; each via point
    is a gate: the path must touch a ridable node within gate_r metres of it, wherever that is cheapest.
    Returns dict(line=[(x, y)], edges=[directed edge ids], cost)."""
    sn = [snap(net, ll, radius) for ll in lls]
    if None in sn: raise RuntimeError("cannot snap a point: " + str(lls[sn.index(None)]))
    edges, mark, prev, total, cur = [], [], None, 0.0, sn[0]
    for k in range(1, len(lls)):
        last = k == len(lls) - 1
        tg = {sn[k]} if last else (gate(net, lls[k], gate_r) or {sn[k]})
        aim = PLL(lls[k]); ar = 0.0 if last else gate_r
        if cur in tg: continue
        r = astar(net, cur, tg, prev, aim=aim, aim_r=ar)
        if r is None: raise RuntimeError("no route to via point %s" % (lls[k],))
        edges += r[0]; mark += [False] * (len(r[0]) - 1) + [not last]; total += r[1]; prev = r[0][-1]; cur = _dto(net, prev)
    # drop spurs (an edge followed by its own reverse) and loops (a node visited twice), but never ones that reach a via gate
    changed = True
    while changed:
        changed = False
        for i in range(len(edges) - 1):
            if edges[i] ^ 1 == edges[i + 1] and not mark[i] and not mark[i + 1]: del edges[i:i + 2]; del mark[i:i + 2]; changed = True; break
        if changed: continue
        seen = {}
        for i, d in enumerate(edges):
            n = _dfrom(net, d)
            if n in seen and not any(mark[seen[n]:i]): del edges[seen[n]:i]; del mark[seen[n]:i]; changed = True; break
            seen[n] = i
    if not edges: return {"line": [net.npos[sn[0]]], "edges": [], "cost": 0.0, "snapped": sn}
    pts = [net.npos[_dfrom(net, edges[0])]] + [net.npos[_dto(net, d)] for d in edges]
    return {"line": pts, "edges": edges, "cost": total, "snapped": sn}

def edge_stats(net, edges):
    """Metres of a directed-edge path by class: cycle (route relation or cycleway), walk (walking sections and steps), main (primary or secondary), and per street name."""
    st = {"len": 0.0, "cycle": 0.0, "walk": 0.0, "main": 0.0, "names": {}}
    for d in edges:
        e = d >> 1; L = net.elen[e]; fl = net.eflag[e]
        st["len"] += L
        if fl & F_CYC: st["cycle"] += L
        if fl & F_WALK: st["walk"] += L
        if fl & F_MAIN: st["main"] += L
        nm = net.names[net.ename[e]] or "(unnamed)"; st["names"][nm] = st["names"].get(nm, 0) + L
    return st

def profile(net, line, reach=22):
    """Match an existing line (list of (x, y)) to the nearest ways and measure it the same way as edge_stats."""
    if getattr(net, "pgrid_for", None) is not id(line) or True:
        pass
    xs = [p[0] for p in line]; ys = [p[1] for p in line]
    x0, y0, x1, y1 = min(xs) - 60, min(ys) - 60, max(xs) + 60, max(ys) + 60
    G = 40; grid = {}
    for e in range(len(net.eu)):
        a = net.npos[net.eu[e]]; b = net.npos[net.ev[e]]
        if max(a[0], b[0]) < x0 or min(a[0], b[0]) > x1 or max(a[1], b[1]) < y0 or min(a[1], b[1]) > y1: continue
        n = max(1, int(math.dist(a, b) // 20))
        ks = {(int((a[0] + (b[0] - a[0]) * i / n) // G), int((a[1] + (b[1] - a[1]) * i / n) // G)) for i in range(n + 1)}
        for k in ks: grid.setdefault(k, []).append(e)
    def segd(p, a, b):
        dx, dy = b[0] - a[0], b[1] - a[1]; L2 = dx * dx + dy * dy or 1e-9
        t = max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2))
        return math.dist(p, (a[0] + dx * t, a[1] + dy * t))
    st = {"len": 0.0, "cycle": 0.0, "walk": 0.0, "main": 0.0, "names": {}}
    for a, b in zip(line, line[1:]):
        L = math.dist(a, b)
        if L < 0.5: continue
        m = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2); tb = math.atan2(b[0] - a[0], -(b[1] - a[1])); best, be = 1e9, None
        cx, cy = int(m[0] // G), int(m[1] // G)
        for i in (cx - 1, cx, cx + 1):
            for j in (cy - 1, cy, cy + 1):
                for e in grid.get((i, j), ()):
                    pa, pb = net.npos[net.eu[e]], net.npos[net.ev[e]]; d = segd(m, pa, pb)
                    if d > reach: continue
                    ba = math.atan2(pb[0] - pa[0], -(pb[1] - pa[1])); ad = abs(ba - tb) % math.pi; ad = min(ad, math.pi - ad)
                    pen = d + (0 if ad < 0.6 else 25)
                    if pen < best: best, be = pen, e
        st["len"] += L
        if be is None: st["names"]["(no way)"] = st["names"].get("(no way)", 0) + L; continue
        fl = net.eflag[be]
        if fl & F_CYC: st["cycle"] += L
        if fl & F_WALK: st["walk"] += L
        if fl & F_MAIN: st["main"] += L
        nm = net.names[net.ename[be]] or "(unnamed)"; st["names"][nm] = st["names"].get(nm, 0) + L
    return st

# ---------------------------------------------------------------- corridor graph
def write_graph(net, segments, stops, out_path, within=500, near_line=40, max_edge=150, max_edge_near=75, prune=150):
    """Write the RouteGraph JSON: the routing graph within `within` metres of the line, simplified.
    segments: list of lines in lng/lat. stops: list of lng/lat. Returns a report dict."""
    line = [PLL(p) for s in segments for p in s]
    # sample the line every ~25 m
    samp = []
    for a, b in zip(line, line[1:]):
        n = max(1, int(math.dist(a, b) // 25))
        for i in range(n): samp.append((a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n))
    samp.append(line[-1])
    G = 100; grid = {}
    for p in samp: grid.setdefault((int(p[0] // G), int(p[1] // G)), []).append(p)
    def dline(p, cap):
        cx, cy = int(p[0] // G), int(p[1] // G); r = int(cap // G) + 1; best = cap + 1
        for i in range(cx - r, cx + r + 1):
            for j in range(cy - r, cy + r + 1):
                for q in grid.get((i, j), ()):
                    d = math.hypot(p[0] - q[0], p[1] - q[1])
                    if d < best: best = d
        return best
    keep = []
    for e in range(len(net.eu)):
        a = net.npos[net.eu[e]]; b = net.npos[net.ev[e]]
        if net.ekind[e] == 0 and net.ename[e] == 0 and net.eflag[e] == 0 and net.elen[e] < 1: continue
        m = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        if dline(m, within) <= within: keep.append(e)
    print("graph: raw edges in corridor", len(keep), flush=True)
    # skip junk: unnamed service roads (driveways, car parks) that are not near the line
    def junk(e):
        return net.ekind[e] == 0 and net.ename[e] == 0 and net.eflag[e] == 0 and abs(net.ecost[e] / max(net.elen[e], 1e-6) - 1.1) < 0.01
    keep2 = []
    for e in keep:
        if junk(e) or net.eflag[e] & F_WALK:
            # car parks, driveways, pavements and steps are no use for finding a way back, except where the line itself goes
            a = net.npos[net.eu[e]]; b = net.npos[net.ev[e]]
            if min(dline(a, near_line), dline(b, near_line)) > near_line: continue
        keep2.append(e)
    keep = keep2
    # adjacency over undirected edges
    adj = {}
    for e in keep:
        adj.setdefault(net.eu[e], []).append(e); adj.setdefault(net.ev[e], []).append(e)
    # largest component(s): drop islands under 12 nodes
    seen = {}; comps = []
    for n0 in adj:
        if n0 in seen: continue
        st = [n0]; seen[n0] = len(comps); cm = [n0]
        while st:
            n = st.pop()
            for e in adj[n]:
                m = net.ev[e] if net.eu[e] == n else net.eu[e]
                if m not in seen: seen[m] = len(comps); st.append(m); cm.append(m)
        comps.append(cm)
    good = {i for i, c in enumerate(comps) if len(c) >= 12}
    keep = [e for e in keep if seen[net.eu[e]] in good]
    adj = {}
    for e in keep:
        adj.setdefault(net.eu[e], []).append(e); adj.setdefault(net.ev[e], []).append(e)
    def other(e, n): return net.ev[e] if net.eu[e] == n else net.eu[e]
    def ekey(e):   # same name, kind and direction semantics
        return (net.ename[e], net.ekind[e], net.eow[e])
    # chains: a chain is a path of undirected edges through degree-2 nodes with the same key
    def deg(n): return len({other(e, n) for e in adj[n]}) if n in adj else 0
    done = set(); chains = []   # each chain: list of node ids from end to end, edge list
    def walk(start_node, first_edge):
        nodesl = [start_node]; edgesl = [first_edge]; n = other(first_edge, start_node); cur = first_edge
        while True:
            nodesl.append(n)
            if deg(n) != 2: break
            nxt = [e for e in adj[n] if e != cur]
            if len(nxt) != 1: break
            e2 = nxt[0]
            if ekey(e2) != ekey(cur) or other(e2, n) in (nodesl[-2],): break
            edgesl.append(e2); cur = e2; n = other(e2, n)
            if n == nodesl[0]: nodesl.append(n); break
        return nodesl, edgesl
    for n in list(adj):
        for e in adj[n]:
            if e in done: continue
            nl, el = walk(n, e)
            for x in el: done.add(x)
            chains.append((nl, el))
    # orientation of one-way edges: net.eow 1 means u->v. Chain edges are oriented n[i] -> n[i+1]
    def chain_ow(nl, el):
        o = net.eow[el[0]]
        if o == 0: return 0
        # direction of the first edge relative to its u->v
        fwd = net.eu[el[0]] == nl[0]
        return 1 if (o == 1) == fwd else -1
    # prune short dead ends iteratively (by chain length) unless near the line
    def clen(el): return sum(net.elen[x] for x in el)
    for _ in range(20):
        d = {}
        for ci, c in enumerate(chains):
            if c[0] is None: continue
            d.setdefault(c[0][0], set()).add(ci); d.setdefault(c[0][-1], set()).add(ci)
        removed = 0
        for ci, (nl, el) in enumerate(chains):
            if nl is None or nl[0] == nl[-1]: continue
            for end, far in ((nl[0], nl[-1]), (nl[-1], nl[0])):
                if len(d.get(end, ())) == 1 and len(d.get(far, ())) >= 2 and clen(el) < prune and dline(net.npos[end], near_line) > near_line:
                    chains[ci] = (None, None); removed += 1; break
        if not removed: break
    chains = [c for c in chains if c[0] is not None]
    # build output: simplify each chain to straight edges
    names = [""]; nameix = {"": 0}
    onodes = []; oix = {}
    def onode(p):
        k = (round(p[0], 1), round(p[1], 1))
        # node identity by OSM node id is handled by callers; for synthetic points use coordinates
        return k
    edges_out = []; nid_out = {}
    def out_node(osm_n):
        if osm_n not in nid_out: nid_out[osm_n] = len(onodes); onodes.append(net.npos[osm_n])
        return nid_out[osm_n]
    def synth(p):
        onodes.append(p); return len(onodes) - 1
    def rdp_ix(pts, eps):
        keepi = [False] * len(pts); keepi[0] = keepi[-1] = True; st = [(0, len(pts) - 1)]
        while st:
            a, b = st.pop(); ax, ay = pts[a]; bx, by = pts[b]; dx, dy = bx - ax, by - ay; L = math.hypot(dx, dy)
            md, mi = 0, -1
            for i in range(a + 1, b):
                dd = abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L if L > 1e-6 else math.dist(pts[i], pts[a])
                if dd > md: md, mi = dd, i
            if md > eps: keepi[mi] = True; st += [(a, mi), (mi, b)]
        return [i for i, k in enumerate(keepi) if k]
    for nl, el in chains:
        ow = chain_ow(nl, el)
        pts = [net.npos[n] for n in nl]
        # cost per metre per edge, accumulate along the chain
        cum_len = [0.0]; cum_cost = [0.0]
        for x in el: cum_len.append(cum_len[-1] + net.elen[x]); cum_cost.append(cum_cost[-1] + net.ecost[x])
        idx = rdp_ix(pts, 5.0)
        k0 = ekey(el[0]); nm = net.names[k0[0]]
        if nm not in nameix: nameix[nm] = len(names); names.append(nm)
        for a, b in zip(idx, idx[1:]):
            L = cum_len[b] - cum_len[a]; C = cum_cost[b] - cum_cost[a]
            chord = math.dist(pts[a], pts[b])
            near = dline(pts[a], near_line) <= near_line or dline(pts[b], near_line) <= near_line or dline(((pts[a][0] + pts[b][0]) / 2, (pts[a][1] + pts[b][1]) / 2), near_line) <= near_line
            cap = max_edge_near if near else max_edge
            parts = max(1, math.ceil(chord / cap))
            ids = [out_node(nl[a])]
            for i in range(1, parts):
                f = i / parts; ids.append(synth((pts[a][0] + (pts[b][0] - pts[a][0]) * f, pts[a][1] + (pts[b][1] - pts[a][1]) * f)))
            ids.append(out_node(nl[b]))
            for u, v in zip(ids, ids[1:]):
                if ow == -1: uu, vv = v, u
                else: uu, vv = u, v
                edges_out.append([uu, vv, max(1, int(round(L / parts))), max(1, int(round(C / parts))), nameix[nm], k0[1], 1 if ow else 0])
    # make sure every stop and every 100 m of the line has a node within 40 m: where the map data has none,
    # add the point itself and join it to the nearest node (the line is rideable by definition)
    ng = {}
    def addg(i):
        p = onodes[i]; ng.setdefault((int(p[0] // 50), int(p[1] // 50)), []).append(i)
    for i in range(len(onodes)): addg(i)
    def nearest_node(p, cap=200):
        cx, cy = int(p[0] // 50), int(p[1] // 50); r = cap // 50 + 1; best = (cap + 1.0, None)
        for i in range(cx - r, cx + r + 1):
            for j in range(cy - r, cy + r + 1):
                for k in ng.get((i, j), ()):
                    d = math.dist(p, onodes[k])
                    if d < best[0]: best = (d, k)
        return best
    checks = [(PLL(st), "stop") for st in stops]
    for sg in segments:
        sl = [PLL(p) for p in sg]; acc = 0.0; nextat = 0.0
        for a, b in zip(sl, sl[1:]):
            L = math.dist(a, b)
            while nextat <= acc + L:
                f = (nextat - acc) / (L or 1); checks.append(((a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f), "line")); nextat += 100
            acc += L
    added = 0
    for p, what in checks:
        d, k = nearest_node(p)
        if d <= 40: continue
        if k is None: continue
        onodes.append(p); ni = len(onodes) - 1; addg(ni); added += 1
        edges_out.append([k, ni, max(1, int(round(d))), max(1, int(round(d))), 0, 4, 0])
    nodes_ll = [[round(LON0 + p[0] / KX, 5), round(LAT0 - p[1] / KY, 5)] for p in onodes]
    kinds = list(KINDS)
    data = {"nodes": nodes_ll, "edges": edges_out, "names": names, "kinds": kinds}
    json.dump(data, open(out_path, "w"), separators=(",", ":"), ensure_ascii=False)
    # coverage check on what was written
    npts = [PLL(p) for p in nodes_ll]
    ng2 = {}
    for p in npts: ng2.setdefault((int(p[0] // 50), int(p[1] // 50)), []).append(p)
    def dnode(p):
        cx, cy = int(p[0] // 50), int(p[1] // 50); best = 1e9
        for i in (cx - 2, cx - 1, cx, cx + 1, cx + 2):
            for j in (cy - 2, cy - 1, cy, cy + 1, cy + 2):
                for q in ng2.get((i, j), ()):
                    d = math.hypot(p[0] - q[0], p[1] - q[1])
                    if d < best: best = d
        return best
    ds = [dnode(p) for p, w in checks if w == "line"]; sd = [dnode(p) for p, w in checks if w == "stop"]
    return {"bytes": os.path.getsize(out_path), "nodes": len(nodes_ll), "edges": len(edges_out), "line_points_checked": len(ds), "line_points_over_40m": sum(1 for d in ds if d > 40),
            "worst_line_m": round(max(ds), 1), "stops_checked": len(sd), "stops_over_40m": sum(1 for d in sd if d > 40), "worst_stop_m": round(max(sd), 1), "joined_points_added": added}
