"""Pack manifests: python3 tools/pack_manifest.py [<pack id> ...]   (no id: every pack in index.json)

Writes public/packs/<id>/manifest.json (every file of the pack folder but the manifest: path, bytes, sha256) and
updates the pack's entry in public/packs/index.json with version, bytes, format and updated. `updated` changes only
when `version` does, so running this again changes nothing. Never edit these files by hand."""
import hashlib, json, os, sys
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PACKS = os.path.join(ROOT, "public", "packs")
FORMAT = 1


def scan(pack_dir):
    files = []
    for dp, _, names in os.walk(pack_dir):
        for n in names:
            full = os.path.join(dp, n)
            rel = os.path.relpath(full, pack_dir).replace(os.sep, "/")
            if rel == "manifest.json": continue
            data = open(full, "rb").read()
            files.append({"path": rel, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
    files.sort(key=lambda f: f["path"])
    return files


def version_of(files):
    text = "".join(f"{f['path']}:{f['sha256']}\n" for f in files)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def write(pack_id, base=PACKS):
    """Write the manifest and update the index entry. Returns the manifest."""
    pack_dir = os.path.join(base, pack_id)
    files = scan(pack_dir)
    ver = version_of(files)
    lines = ",\n".join("  " + json.dumps(f, separators=(",", ":")) for f in files)
    head = json.dumps({"id": pack_id, "version": ver, "format": FORMAT}, separators=(",", ":"))[:-1]
    with open(os.path.join(pack_dir, "manifest.json"), "w", encoding="utf-8") as fh:
        fh.write(head + ',"files":[\n' + lines + "\n]}\n")
    ip = os.path.join(base, "index.json")
    idx = json.load(open(ip, encoding="utf-8"))
    for e in idx["packs"]:
        if e["id"] != pack_id: continue
        changed = e.get("version") != ver
        e["version"] = ver
        e["bytes"] = sum(f["bytes"] for f in files)
        e["format"] = FORMAT
        if changed or "updated" not in e:
            e["updated"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        break
    else:
        raise SystemExit(f"{pack_id} is not in {ip}")
    json.dump(idx, open(ip, "w", encoding="utf-8"), separators=(",", ":"), ensure_ascii=False)
    print(f"manifest {pack_id}: version {ver}, {len(files)} files, {e['bytes']} bytes, updated {e['updated']}")
    return {"id": pack_id, "version": ver, "format": FORMAT, "files": files}


def main(argv):
    ids = argv or [e["id"] for e in json.load(open(os.path.join(PACKS, "index.json")))["packs"]]
    for i in ids: write(i)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
