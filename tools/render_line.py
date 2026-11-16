"""Draw the re-planned segments for a look: old line grey, new line magenta, water blue, stops numbered, street names of the cues.
Writes /tmp/line-<seg>.png for every segment in <id>.plan.json (and /tmp/line-all.png for the whole route with --all).
Usage: OSM_DIR=/home/claude/osm python3 tools/render_line.py [thames-loop] [--all]"""
import json, math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
import router
from router import PLL

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
args = [a for a in sys.argv[1:] if not a.startswith("--")]
PACK = args[0] if args else "thames-loop"
track = json.load(open(os.path.join(ROOT, "tools", "content", PACK + ".track.json")))
plan = json.load(open(os.path.join(ROOT, "tools", "content", PACK + ".plan.json")))["replan"]
pk = os.path.join(ROOT, "public", "packs", PACK, "pack.json")
pack = json.load(open(pk)) if os.path.exists(pk) else None
net = router.load()
stops = pack["stops"] if pack else []

def draw(sids, fn, pad=350, title="", box=None):
    fig, ax = plt.subplots(figsize=(11, 11 * 0.8), dpi=110)
    pts = [PLL(p) for s in sids for src in (track["segments"], track.get("old", {})) if str(s) in src for p in src[str(s)]]
    x0, x1 = min(p[0] for p in pts) - pad, max(p[0] for p in pts) + pad; y0, y1 = min(p[1] for p in pts) - pad, max(p[1] for p in pts) + pad
    if box: x0, y0 = PLL((box[0], box[3])); x1, y1 = PLL((box[2], box[1]))
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2; w, h = x1 - x0, y1 - y0
    if w / h > 1.25: h = w / 1.25
    else: w = h * 1.25
    x0, x1, y0, y1 = cx - w / 2, cx + w / 2, cy - h / 2, cy + h / 2
    ax.set_facecolor("#f3f1ea")
    for role, ring in net.water:
        if max(p[0] for p in ring) < x0 or min(p[0] for p in ring) > x1 or max(p[1] for p in ring) < y0 or min(p[1] for p in ring) > y1: continue
        ax.fill([p[0] for p in ring], [p[1] for p in ring], color="#a9cde8" if role == "outer" else "#f3f1ea", lw=0, zorder=1 if role == "outer" else 2)
    for e in range(len(net.eu)):
        a, b = net.npos[net.eu[e]], net.npos[net.ev[e]]
        if not (x0 < a[0] < x1 and y0 < a[1] < y1): continue
        fl = net.eflag[e]
        col = "#2e9e5b" if fl & router.F_CYC else "#c9a227" if fl & router.F_WALK else "#bbbbbb"
        ax.plot([a[0], b[0]], [a[1], b[1]], color=col, lw=0.9 if fl & (router.F_CYC | router.F_WALK) else 0.6, alpha=0.7, zorder=3)
    for s in sids:
        o = track.get("old", {}).get(str(s))
        if o: ax.plot([PLL(p)[0] for p in o], [PLL(p)[1] for p in o], color="#555555", lw=3.5, alpha=0.8, zorder=4, label="old line" if s == sids[0] else None)
        n = track["segments"][str(s)]
        ax.plot([PLL(p)[0] for p in n], [PLL(p)[1] for p in n], color="#d0127f", lw=2.2, zorder=5, label="new line" if s == sids[0] else None)
    if pack:
        for c in pack["cues"]:
            if c["seg"] in sids and not c.get("quiet"):
                p = PLL(c["at"])
                if x0 < p[0] < x1 and y0 < p[1] < y1:
                    ax.plot(*p, "o", color="#d0127f", ms=4, zorder=6); ax.annotate(c["name"], p, fontsize=6.5, xytext=(3, 3), textcoords="offset points", zorder=7, bbox=dict(fc="white", ec="none", alpha=0.75, pad=0.5))
    for sid_, spec in plan.items():
        if int(sid_) in sids:
            for v in spec["via"]: q = PLL(v); ax.plot(*q, "x", color="black", ms=9, mew=2, zorder=10)
    for i, st in enumerate(stops):
        p = PLL(st["at"])
        if x0 < p[0] < x1 and y0 < p[1] < y1:
            ax.plot(*p, "o", color="#1b3a8a", ms=13, zorder=8); ax.text(p[0], p[1], str(i), color="white", ha="center", va="center", fontsize=7, zorder=9, weight="bold")
    ax.set_xlim(x0, x1); ax.set_ylim(y1, y0); ax.set_aspect("equal"); ax.set_xticks([]); ax.set_yticks([])
    ax.legend(loc="lower left", fontsize=7); ax.set_title(title or fn, fontsize=9)
    fig.savefig(fn, bbox_inches="tight"); plt.close(fig)
box = next((tuple(float(v) for v in a[6:].split(",")) for a in sys.argv if a.startswith("--box=")), None)
if box:
    draw([int(s) for s in plan], "/tmp/line-zoom.png", title="zoom", box=box); sys.exit(0)
for sid in plan: draw([int(sid)], f"/tmp/line-{sid}.png", title=f"segment {sid}: " + plan[sid]["why"][:90])
if "--all" in sys.argv: draw(list(range(1, 13)), "/tmp/line-all.png", pad=200, title="whole route")
print("rendered")
