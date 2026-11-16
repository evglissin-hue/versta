"""Download OpenStreetMap extracts for the cells a planned route passes through, into OSM_DIR.
Be gentle with the OSM API: this is a one-off per route. Usage: OSM_DIR=/tmp/osm python3 tools/fetch_osm.py thames-loop"""
import re, subprocess, time, os, math, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PACK = sys.argv[1] if len(sys.argv) > 1 else "thames-loop"
os.makedirs(os.environ.get("OSM_DIR", "/home/claude/osm"), exist_ok=True); os.chdir(os.environ.get("OSM_DIR", "/home/claude/osm"))
UA = "StoriedRoutes/0.1 (personal non-commercial project)"
pts = []
for f in [os.path.join(ROOT, "tools", "content", PACK + ".out.gpx"), os.path.join(ROOT, "tools", "content", PACK + ".back.gpx")]:
    pts += [(float(a), float(b)) for a, b in re.findall(r'<trkpt lat="([-\d.]+)" lon="([-\d.]+)"', open(f).read())]
CW, CH = 0.008, 0.005
cells = set()
for la, lo in pts:
    for dla in (-0.0022, 0, 0.0022):
        for dlo in (-0.0035, 0, 0.0035):
            cells.add((math.floor((lo + dlo) / CW), math.floor((la + dla) / CH)))
cells = sorted(cells)
print("cells", len(cells), flush=True)
for i, (cx, cy) in enumerate(cells):
    fn = f"cell_{cx}_{cy}.xml"
    if os.path.exists(fn) and os.path.getsize(fn) > 500: continue
    bbox = f"{cx*CW:.4f},{cy*CH:.4f},{(cx+1)*CW:.4f},{(cy+1)*CH:.4f}"
    for attempt in range(4):
        r = subprocess.run(["curl","-s","--max-time","90","--compressed","-A",UA,"-o",fn,"-w","%{http_code}",f"https://api.openstreetmap.org/api/0.6/map?bbox={bbox}"],capture_output=True,text=True).stdout
        if r == "200": break
        time.sleep(5 + 5 * attempt)
    print(i, fn, r, os.path.getsize(fn) if os.path.exists(fn) else 0, flush=True)
    time.sleep(0.6)
print("FETCH_DONE", flush=True)
