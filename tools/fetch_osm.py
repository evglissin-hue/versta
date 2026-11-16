"""Download OpenStreetMap extracts for the cells near a planned route, into OSM_DIR.
Cells are 0.008 x 0.005 degrees. A cell is fetched when any point of the route (the line in
tools/content/<id>.track.json, the old line of re-planned segments, and the via points in
<id>.plan.json) lies within MARGIN metres of it. Cells already on disk are reused.
Be gentle with the OSM API: one request per cell, a pause between requests, a descriptive User-Agent.
Usage: OSM_DIR=/home/claude/osm python3 tools/fetch_osm.py thames-loop [margin_metres=700] [--dry]
Extra areas: pass lng,lat pairs after the options to add a point of interest, for example 2 or 3 via points."""
import json, subprocess, time, os, math, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
args = [a for a in sys.argv[1:] if not a.startswith("--")]
DRY = "--dry" in sys.argv
PACK = args[0] if args else "thames-loop"
MARGIN = float(args[1]) if len(args) > 1 else 700.0
EXTRA = [tuple(map(float, a.split(","))) for a in args[2:]]
OSM = os.environ.get("OSM_DIR", "/home/claude/osm")
UA = "VerstaRoutePlanner/0.2 (personal non-commercial hobby project; one-off cell downloads)"
CW, CH = 0.008, 0.005
track = json.load(open(os.path.join(ROOT, "tools", "content", PACK + ".track.json")))
pts = [tuple(p) for s in track["segments"].values() for p in s] + [tuple(p) for s in track.get("old", {}).values() for p in s] + EXTRA
plan_f = os.path.join(ROOT, "tools", "content", PACK + ".plan.json")
if os.path.exists(plan_f):
    for r in json.load(open(plan_f))["replan"].values(): pts += [tuple(v) for v in r["via"]]
LAT0 = 51.5
KX = 111320 * math.cos(math.radians(LAT0)); KY = 110540
# thin the points: one per 60 m is plenty for a 700 m margin
thin, last = [], None
for p in pts:
    if last is None or math.hypot((p[0] - last[0]) * KX, (p[1] - last[1]) * KY) > 60: thin.append(p); last = p
cells = set()
for lo, la in thin:
    dlo, dla = MARGIN / KX, MARGIN / KY
    for cx in range(math.floor((lo - dlo) / CW), math.floor((lo + dlo) / CW) + 1):
        for cy in range(math.floor((la - dla) / CH), math.floor((la + dla) / CH) + 1):
            nx = min(max(lo, cx * CW), (cx + 1) * CW); ny = min(max(la, cy * CH), (cy + 1) * CH)
            if math.hypot((nx - lo) * KX, (ny - la) * KY) <= MARGIN: cells.add((cx, cy))
cells = sorted(cells)
todo = [c for c in cells if not (os.path.exists(os.path.join(OSM, f"cell_{c[0]}_{c[1]}.xml")) and os.path.getsize(os.path.join(OSM, f"cell_{c[0]}_{c[1]}.xml")) > 500)]
print("cells needed", len(cells), "missing", len(todo), flush=True)
if DRY: sys.exit(0)
os.makedirs(OSM, exist_ok=True); os.chdir(OSM)
for i, (cx, cy) in enumerate(todo):
    fn = f"cell_{cx}_{cy}.xml"
    bbox = f"{cx*CW:.4f},{cy*CH:.4f},{(cx+1)*CW:.4f},{(cy+1)*CH:.4f}"
    for attempt in range(4):
        r = subprocess.run(["curl", "-s", "--max-time", "90", "--compressed", "-A", UA, "-o", fn, "-w", "%{http_code}", f"https://api.openstreetmap.org/api/0.6/map?bbox={bbox}"], capture_output=True, text=True).stdout
        if r == "200": break
        time.sleep(5 + 5 * attempt)
    print(i, fn, r, os.path.getsize(fn) if os.path.exists(fn) else 0, flush=True)
    time.sleep(0.8)
print("FETCH_DONE", flush=True)
