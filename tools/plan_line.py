"""Plan the re-planned segments of a route with tools/router.py and write the line to tools/content/<id>.track.json.
Segments listed in <id>.plan.json are routed through their via points. The old line of every re-planned segment is kept
under "old" so pictures and comparisons can use it. A plan entry with "keep_old": true keeps the first line.
A plan entry may give "from" and "to" ([lng, lat]): where the segment starts and ends, when a stop has moved (else the
ends of the old line). A stop that only moves along the line it already sits on needs no routing: "splits" in the plan
file maps a stop number k to [lng, lat], and the boundary between segments k and k + 1 moves to the point of the line
nearest to it (the two segments together keep exactly the same line). After planning, every segment must start where
the one before it ends: a gap is printed.
Usage: OSM_DIR=/home/claude/osm python3 tools/plan_line.py [thames-loop] [--dry] [--only=1,2,stop11]
  --only plans just those segments (and with stopK, moves just stop K of "splits") and leaves every other segment as it
  is (its cues are recorded)."""
import json, math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import router
from router import PLL, LL

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
args = [a for a in sys.argv[1:] if not a.startswith("--")]
PACK = args[0] if args else "thames-loop"
DRY = "--dry" in sys.argv
ONLY = next((set(a.split("=", 1)[1].split(",")) for a in sys.argv[1:] if a.startswith("--only=")), None)
tf = os.path.join(ROOT, "tools", "content", PACK + ".track.json")
track = json.load(open(tf)); plan = json.load(open(os.path.join(ROOT, "tools", "content", PACK + ".plan.json")))["replan"]
segs, old = track["segments"], track.get("old", {})

def densify(pts, step=12):
    out = [pts[0]]
    for a, b in zip(pts, pts[1:]):
        d = math.dist(a, b); n = max(1, int(d // step))
        for i in range(1, n + 1): out.append((a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n))
    return out
def length(pts): return sum(math.dist(a, b) for a, b in zip(pts, pts[1:]))

def report(tag, st, ln):
    top = [(n, m) for n, m in st["names"].items() if m >= 20]   # in ride order (first time each street is used)
    print(f"  {tag}: {ln:.0f} m | cycle routes/cycleways {100 * st['cycle'] / max(st['len'], 1):.0f}% | walking {st['walk']:.0f} m | primary/secondary {st['main']:.0f} m")
    print("     streets: " + ", ".join(f"{n} {m:.0f}" for n, m in top))

net = router.load()
for sid, spec in sorted(plan.items(), key=lambda kv: int(kv[0])):
    if ONLY is not None and sid not in ONLY: continue
    o = old.get(sid) or segs[sid]
    ol = [PLL(p) for p in o]
    print(f"segment {sid}: {spec['why']}")
    report("old", router.profile(net, ol), length(ol))
    if spec.get("keep_old"): print("  keeping the old line (keep_old)"); segs[sid] = o; old.setdefault(sid, o); continue
    # the line must start and end where its neighbours do, so the pack stays continuous
    first, last = spec.get("from") or o[0], spec.get("to") or o[-1]
    # "avoid": street names whose cost is multiplied for this segment only (keeps the router honest about where the story is)
    saved = {}
    for nm, mult in spec.get("avoid", {}).items():
        if nm in net.names:
            ix = net.names.index(nm)
            for e in range(len(net.eu)):
                if net.ename[e] == ix: saved[e] = net.ecost[e]; net.ecost[e] *= mult
    try: r = router.route(net, [first] + spec["via"] + [last], gate_r=spec.get("gate", 60))
    finally:
        for e, c in saved.items(): net.ecost[e] = c
    line = [PLL(first)] + r["line"] + [PLL(last)]
    nl = densify(line)
    st = router.edge_stats(net, r["edges"])
    report("new", st, length(line))
    # distance of the new line from the stops it must serve is the builder's concern; here only continuity
    if not DRY: old.setdefault(sid, o); segs[sid] = [LL(p) for p in nl]
# continuity: segment i starts where segment i - 1 ends
def metres(a, b):
    k = math.cos(math.radians((a[1] + b[1]) / 2))
    return math.hypot((a[0] - b[0]) * 111320 * k, (a[1] - b[1]) * 110540)
rf = os.path.join(ROOT, "tools", "content", PACK + ".route.json")
fixed = {i for i, st in enumerate(next((r for r in json.load(open(rf)) if r["id"] == PACK), {"stops": []})["stops"]) if st.get("fixed_segment")} if os.path.exists(rf) else set()
for i in sorted((int(k) for k in segs), key=int)[1:]:
    a, b = segs.get(str(i - 1)), segs.get(str(i))
    # a fixed segment (a straight walk, as through a foot tunnel) is drawn stop to stop by the builder, whatever its track
    if i in fixed or i - 1 in fixed: continue
    if a and b and metres(a[-1], b[0]) > 2: print(f"GAP segment {i - 1} ends {metres(a[-1], b[0]):.0f} m from where segment {i} starts")
# stops that move along their own line: cut the joined line of segments k and k + 1 at the nearest point
for sid, at in sorted(json.load(open(os.path.join(ROOT, "tools", "content", PACK + ".plan.json"))).get("splits", {}).items(), key=lambda kv: int(kv[0])):
    if ONLY is not None and f"stop{sid}" not in ONLY: continue
    nxt = str(int(sid) + 1)
    a, b = [PLL(p) for p in segs[sid]], [PLL(p) for p in segs[nxt]]
    joined = a + b[1:]
    t = PLL(at); best = None
    for j, (p, q) in enumerate(zip(joined, joined[1:])):
        dx, dy = q[0] - p[0], q[1] - p[1]; L2 = dx * dx + dy * dy or 1e-9
        u = max(0.0, min(1.0, ((t[0] - p[0]) * dx + (t[1] - p[1]) * dy) / L2))
        c = (p[0] + dx * u, p[1] + dy * u); d = math.dist(t, c)
        if best is None or d < best[0]: best = (d, j, c)
    d, j, c = best
    moved = length(joined[:j + 1] + [c]) - length(a)
    print(f"stop {sid} moves {abs(moved):.0f} m {'on' if moved > 0 else 'back'} along the line (the point is {d:.0f} m from it)")
    if not DRY:
        old.setdefault(sid, segs[sid]); old.setdefault(nxt, segs[nxt])
        def dedup(pts): return [p for k, p in enumerate(pts) if k == 0 or math.dist(p, pts[k - 1]) > 0.05]
        segs[sid] = [LL(p) for p in dedup(joined[:j + 1] + [c])]
        segs[nxt] = [LL(p) for p in dedup([c] + joined[j + 1:])]
if not DRY:
    track["old"] = old; track["segments"] = segs
    json.dump(track, open(tf, "w"), separators=(",", ":"))
    print("wrote", tf)
