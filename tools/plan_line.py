"""Plan the re-planned segments of a route with tools/router.py and write the line to tools/content/<id>.track.json.
Segments listed in <id>.plan.json are routed through their via points. The old line of every re-planned segment is kept
under "old" so pictures and comparisons can use it. A plan entry with "keep_old": true keeps the first line.
Usage: OSM_DIR=/home/claude/osm python3 tools/plan_line.py [thames-loop] [--dry]"""
import json, math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import router
from router import PLL, LL

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
args = [a for a in sys.argv[1:] if not a.startswith("--")]
PACK = args[0] if args else "thames-loop"
DRY = "--dry" in sys.argv
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
    o = old.get(sid) or segs[sid]
    ol = [PLL(p) for p in o]
    print(f"segment {sid}: {spec['why']}")
    report("old", router.profile(net, ol), length(ol))
    if spec.get("keep_old"): print("  keeping the old line (keep_old)"); segs[sid] = o; old.setdefault(sid, o); continue
    # the line must start and end where its neighbours do, so the pack stays continuous
    first, last = o[0], o[-1]
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
if not DRY:
    track["old"] = old; track["segments"] = segs
    json.dump(track, open(tf, "w"), separators=(",", ":"))
    print("wrote", tf)
