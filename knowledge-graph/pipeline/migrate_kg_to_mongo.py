"""
migrate_kg_to_mongo.py — move the remaining on-disk KG data into MongoDB so the
backend no longer needs the data/knowledge-graph/ volume.

Loads, under the *active* atlas version (set by build_atlas_tiles.py):
  graphs/<facultyId>.json      -> kg_faculty_graphs  (one doc per faculty)
  graphs/index.json            -> kg_indices name="faculty-search-index"
  atlas_faculty_indices.json   -> kg_indices name="faculty-atlas-indices"
  (derived)                    -> kg_indices name="department-atlas-indices"
  explore_index.json           -> kg_explore  (kind "term" rows + kind "detail")

Idempotent: rewrites all docs for the target version. Run AFTER build_atlas_tiles
so every collection shares one version; pass --version to override.

Usage
-----
  MONGO_URI=... python migrate_kg_to_mongo.py [--data-dir PATH] [--version V]
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

from pymongo import MongoClient, UpdateOne

ROOT = Path(__file__).resolve().parent.parent
PROJECT_ROOT = ROOT.parent
DEFAULT_DATA_DIR = PROJECT_ROOT / "data" / "knowledge-graph"

try:
    from dotenv import load_dotenv

    load_dotenv(PROJECT_ROOT / ".env")
except ImportError:
    pass


def _load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _resolve_version(db, override):
    if override:
        return override
    ptr = db.atlas_meta.find_one({"_id": "active", "kind": "pointer"})
    if not ptr or not ptr.get("version"):
        raise SystemExit(
            "No active atlas version. Run build_atlas_tiles.py first, or pass --version."
        )
    return ptr["version"]


def _migrate_faculty_graphs(db, version, graphs_dir):
    if not graphs_dir.exists():
        print("[migrate] graphs/ missing — skipping faculty graphs")
        return
    db.kg_faculty_graphs.create_index([("version", 1), ("facultyId", 1)], unique=True)
    db.kg_faculty_graphs.delete_many({"version": version})
    ops = []
    count = 0
    for file in graphs_dir.glob("*.json"):
        if file.name == "index.json":
            continue
        faculty_id = file.stem
        graph = _load_json(file)
        ops.append(
            UpdateOne(
                {"version": version, "facultyId": faculty_id},
                {"$set": {"version": version, "facultyId": faculty_id, "graph": graph}},
                upsert=True,
            )
        )
        count += 1
        if len(ops) >= 200:
            db.kg_faculty_graphs.bulk_write(ops, ordered=False)
            ops = []
    if ops:
        db.kg_faculty_graphs.bulk_write(ops, ordered=False)
    print(f"[migrate] faculty graphs: {count}")


def _put_index(db, version, name, payload):
    db.kg_indices.update_one(
        {"version": version, "name": name},
        {"$set": {"version": version, "name": name, "payload": payload}},
        upsert=True,
    )


def _migrate_indices(db, version, data_dir):
    db.kg_indices.create_index([("version", 1), ("name", 1)], unique=True)

    search_index = []
    index_file = data_dir / "graphs" / "index.json"
    if index_file.exists():
        search_index = _load_json(index_file)
        _put_index(db, version, "faculty-search-index", search_index)
        print(f"[migrate] faculty-search-index: {len(search_index)}")

    faculty_indices = {}
    fi_file = data_dir / "atlas_faculty_indices.json"
    if fi_file.exists():
        parsed = _load_json(fi_file)
        faculty_indices = parsed.get("byFacultyId", parsed) or {}
        _put_index(db, version, "faculty-atlas-indices", faculty_indices)
        print(f"[migrate] faculty-atlas-indices: {len(faculty_indices)}")

    # Derive department -> {indices, facultyCount} (was a runtime build before).
    if search_index and faculty_indices:
        by_dept = {}
        for fac in search_index:
            dept = str(fac.get("department", "")).strip()
            if not dept:
                continue
            entry = by_dept.setdefault(dept, {"indices": set(), "facultyCount": 0})
            entry["facultyCount"] += 1
            for idx in faculty_indices.get(fac.get("facultyId", ""), []):
                entry["indices"].add(idx)
        dept_payload = {
            dept: {"indices": sorted(e["indices"]), "facultyCount": e["facultyCount"]}
            for dept, e in by_dept.items()
        }
        _put_index(db, version, "department-atlas-indices", dept_payload)
        print(f"[migrate] department-atlas-indices: {len(dept_payload)}")


def _migrate_explore(db, version, data_dir):
    explore_file = data_dir / "explore_index.json"
    if not explore_file.exists():
        print("[migrate] explore_index.json missing — skipping")
        return
    explore = _load_json(explore_file)
    db.kg_explore.create_index([("version", 1), ("kind", 1), ("key", 1)])
    db.kg_explore.create_index([("version", 1), ("kind", 1), ("type", 1)])
    db.kg_explore.delete_many({"version": version})

    ops = []
    for row in explore.get("terms", []):
        ops.append({
            "version": version, "kind": "term",
            "term": row.get("term", ""), "type": row.get("type", ""), "payload": row,
        })
    for key, detail in (explore.get("detail", {}) or {}).items():
        ops.append({"version": version, "kind": "detail", "key": key, "payload": detail})

    for i in range(0, len(ops), 500):
        db.kg_explore.insert_many(ops[i:i + 500], ordered=False)
    print(f"[migrate] explore: {len(explore.get('terms', []))} terms + "
          f"{len(explore.get('detail', {}) or {})} details")


def migrate(data_dir=DEFAULT_DATA_DIR, version_override=None, mongo_uri=None):
    mongo_uri = mongo_uri or os.environ.get("MONGO_URI") or os.environ.get("KG_MONGO_URI")
    if not mongo_uri:
        raise SystemExit("MONGO_URI not set")
    data_dir = Path(data_dir)

    client = MongoClient(mongo_uri)
    db = client.get_default_database()
    if db is None:
        db = client["research_ambit"]

    version = _resolve_version(db, version_override)
    print(f"[migrate] target version {version}")

    _migrate_faculty_graphs(db, version, data_dir / "graphs")
    _migrate_indices(db, version, data_dir)
    _migrate_explore(db, version, data_dir)

    client.close()
    print("[migrate] done")
    return version


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", default=str(DEFAULT_DATA_DIR))
    ap.add_argument("--version", default=None)
    ap.add_argument("--mongo-uri", default=None)
    args = ap.parse_args()
    t0 = time.time()
    migrate(args.data_dir, args.version, args.mongo_uri)
    print(f"[migrate] finished in {time.time() - t0:.1f}s")


if __name__ == "__main__":
    sys.exit(main())
