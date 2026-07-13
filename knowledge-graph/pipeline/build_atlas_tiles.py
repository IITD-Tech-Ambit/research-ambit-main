"""
build_atlas_tiles.py — turn the monolithic atlas_papers.json point cloud into a
streamable octree LOD pyramid stored in MongoDB (3D-Tiles / Potree model).

Why
---
atlas_papers.json is ~27 MB (66k papers, mostly inline title/taxonomy strings)
and is shipped whole to every client. Here we:
  1. build an octree with *additive* LOD — each node keeps a spatially-uniform
     grid subsample (highest-citation point per cell wins, so important papers
     surface at coarse zoom); the rest sink to child octants. A point is stored
     exactly once, so total bytes ~= pointCount * 15 B (~1 MB for 66k).
  2. quantize each node to a compact binary tile (see BINARY LAYOUT below).
  3. write one doc per node to `atlas_tiles`, a headers-only hierarchy + taxonomy
     dict to `atlas_meta`, then atomically flip the `active` pointer.

The client streams only nodes intersecting the camera frustum whose projected
screen-space error is too high, decoding tiles into GPU buffers.

BINARY LAYOUT (little-endian, per node)
---------------------------------------
  uint32   pointCount (n)
  uint32   index[n]        global paper index `i` (for picking / highlight)
  uint8    oid[12n]        Mongo ObjectId bytes (so the client can fetch meta)
  uint16   pos[3n]         x,y,z quantized over the GLOBAL bbox
  uint16   domainId[n]     index into dict.domains
  uint16   citations[n]    clamped to 65535
  uint8    themeId[n]      index into dict.themes
Sections are ordered so every typed-array view stays aligned on the client
(index/pos offsets are multiples of 4/2). Dequantize:
  v = bboxMin + q/65535 * (bboxMax - bboxMin).

Usage
-----
  MONGO_URI=... python build_atlas_tiles.py [--atlas PATH] [--capacity 4096]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import struct
import sys
import time
from pathlib import Path

from pymongo import MongoClient, UpdateOne

ROOT = Path(__file__).resolve().parent.parent          # knowledge-graph/
PROJECT_ROOT = ROOT.parent                             # research-ambit-main/
DEFAULT_ATLAS = PROJECT_ROOT / "data" / "knowledge-graph" / "atlas_papers.json"

# Grid resolution per node: up to GRID_RES^3 kept points, but capacity caps it.
GRID_RES = 16
MAX_DEPTH = 12
DEFAULT_CAPACITY = 4096
KEEP_VERSIONS = 2  # active + previous, older builds are GC'd

try:
    from dotenv import load_dotenv

    load_dotenv(PROJECT_ROOT / ".env")
except ImportError:
    pass


def _bbox(points):
    xs = [p["x"] for p in points]
    ys = [p["y"] for p in points]
    zs = [p["z"] for p in points]
    lo = [min(xs), min(ys), min(zs)]
    hi = [max(xs), max(ys), max(zs)]
    # Pad so points on the max face still quantize inside range.
    for a in range(3):
        span = hi[a] - lo[a] or 1.0
        lo[a] -= span * 1e-4
        hi[a] += span * 1e-4
    return lo, hi


def _quantize(value, lo, hi):
    t = (value - lo) / (hi - lo) if hi > lo else 0.0
    q = int(round(t * 65535))
    return 0 if q < 0 else 65535 if q > 65535 else q


class OctreeNode:
    __slots__ = ("key", "bounds_lo", "bounds_hi", "depth", "points", "children")

    def __init__(self, key, bounds_lo, bounds_hi, depth):
        self.key = key
        self.bounds_lo = bounds_lo
        self.bounds_hi = bounds_hi
        self.depth = depth
        self.points = []       # kept points (this LOD level)
        self.children = {}     # octant index -> OctreeNode


def _grid_subsample(points, lo, hi, capacity):
    """Keep the highest-citation point per grid cell; return (kept, overflow)."""
    res = GRID_RES
    best = {}  # cell -> point
    size = [(hi[a] - lo[a]) or 1.0 for a in range(3)]
    for p in points:
        cell = 0
        for a, axis in enumerate(("x", "y", "z")):
            c = int((p[axis] - lo[a]) / size[a] * res)
            c = 0 if c < 0 else res - 1 if c >= res else c
            cell = cell * res + c
        cur = best.get(cell)
        if cur is None or (p.get("citations", 0), -p["i"]) > (cur.get("citations", 0), -cur["i"]):
            best[cell] = p

    kept_set = set(id(p) for p in best.values())
    kept = list(best.values())
    # Respect capacity: keep the most-cited kept points, demote the rest.
    if len(kept) > capacity:
        kept.sort(key=lambda p: (p.get("citations", 0), -p["i"]), reverse=True)
        demoted = kept[capacity:]
        kept = kept[:capacity]
        kept_set = set(id(p) for p in kept)
        for p in demoted:
            pass  # falls through to overflow below
    overflow = [p for p in points if id(p) not in kept_set]
    return kept, overflow


def _octant(point, lo, hi):
    mid = [(lo[a] + hi[a]) / 2.0 for a in range(3)]
    idx = 0
    for a, axis in enumerate(("x", "y", "z")):
        if point[axis] >= mid[a]:
            idx |= 1 << a
    return idx


def _child_bounds(lo, hi, octant):
    mid = [(lo[a] + hi[a]) / 2.0 for a in range(3)]
    clo = list(lo)
    chi = list(hi)
    for a in range(3):
        if octant & (1 << a):
            clo[a] = mid[a]
        else:
            chi[a] = mid[a]
    return clo, chi


def build_octree(points, capacity):
    root = OctreeNode("r", *_bbox(points), 0)
    root_lo, root_hi = root.bounds_lo, root.bounds_hi
    # Iterative to avoid recursion limits at scale.
    stack = [(root, points)]
    while stack:
        node, pts = stack.pop()
        if len(pts) <= capacity or node.depth >= MAX_DEPTH:
            node.points = pts
            continue
        kept, overflow = _grid_subsample(pts, node.bounds_lo, node.bounds_hi, capacity)
        node.points = kept
        if not overflow:
            continue
        buckets = {}
        for p in overflow:
            buckets.setdefault(_octant(p, node.bounds_lo, node.bounds_hi), []).append(p)
        for octant, bucket in buckets.items():
            clo, chi = _child_bounds(node.bounds_lo, node.bounds_hi, octant)
            child = OctreeNode(f"{node.key}-{octant}", clo, chi, node.depth + 1)
            node.children[octant] = child
            stack.append((child, bucket))
    return root, root_lo, root_hi


def _oid_bytes(paper_id):
    s = str(paper_id or "")
    if len(s) == 24:
        try:
            return bytes.fromhex(s)
        except ValueError:
            pass
    return b"\x00" * 12


def encode_tile(points, theme_ids, domain_ids, bbox_lo, bbox_hi):
    n = len(points)
    out = bytearray()
    out += struct.pack("<I", n)
    out += b"".join(struct.pack("<I", p["i"]) for p in points)
    out += b"".join(_oid_bytes(p.get("id")) for p in points)
    for p in points:
        out += struct.pack(
            "<HHH",
            _quantize(p["x"], bbox_lo[0], bbox_hi[0]),
            _quantize(p["y"], bbox_lo[1], bbox_hi[1]),
            _quantize(p["z"], bbox_lo[2], bbox_hi[2]),
        )
    out += b"".join(struct.pack("<H", domain_ids.get(p.get("domain", ""), 0)) for p in points)
    out += b"".join(struct.pack("<H", min(int(p.get("citations", 0) or 0), 65535)) for p in points)
    out += bytes(theme_ids.get(p.get("theme", ""), 0) for p in points)
    return bytes(out)


def _anchors(points, key_fields):
    """Centroid + count grouped by the tuple of key_fields (for CSS2D labels)."""
    groups = {}
    for p in points:
        gk = tuple(p.get(f, "") for f in key_fields)
        g = groups.setdefault(gk, {"x": 0.0, "y": 0.0, "z": 0.0, "count": 0})
        g["x"] += p["x"]
        g["y"] += p["y"]
        g["z"] += p["z"]
        g["count"] += 1
    out = []
    for gk, g in groups.items():
        c = g["count"] or 1
        row = {f: gk[i] for i, f in enumerate(key_fields)}
        row.update({"x": g["x"] / c, "y": g["y"] / c, "z": g["z"] / c, "count": g["count"]})
        out.append(row)
    out.sort(key=lambda r: r["count"], reverse=True)
    return out


def build_atlas_tiles(atlas_path=DEFAULT_ATLAS, capacity=DEFAULT_CAPACITY, mongo_uri=None):
    mongo_uri = mongo_uri or os.environ.get("MONGO_URI") or os.environ.get("KG_MONGO_URI")
    if not mongo_uri:
        raise SystemExit("MONGO_URI not set")
    atlas_path = Path(atlas_path)
    if not atlas_path.exists():
        raise SystemExit(f"atlas file not found: {atlas_path}")

    raw = atlas_path.read_bytes()
    version = hashlib.sha1(raw).hexdigest()[:12]
    atlas = json.loads(raw)
    papers = atlas.get("papers", [])
    if not papers:
        raise SystemExit("atlas has no papers")
    print(f"[tiles] {len(papers):,} papers -> version {version}")

    # Taxonomy dictionaries (stable id assignment: sorted names).
    themes = sorted({p.get("theme", "") for p in papers})
    domains = sorted({p.get("domain", "") for p in papers})
    theme_ids = {name: i for i, name in enumerate(themes)}
    domain_ids = {name: i for i, name in enumerate(domains)}

    root, bbox_lo, bbox_hi = build_octree(papers, capacity)

    # Serialize every node; collect headers-only hierarchy.
    nodes_header = {}
    tile_ops = []
    stack = [root]
    node_count = 0
    point_check = 0
    while stack:
        node = stack.pop()
        child_mask = 0
        for octant, child in node.children.items():
            child_mask |= 1 << octant
            stack.append(child)
        payload = encode_tile(node.points, theme_ids, domain_ids, bbox_lo, bbox_hi)
        tile_ops.append(
            UpdateOne(
                {"version": version, "nodeKey": node.key},
                {"$set": {"version": version, "nodeKey": node.key,
                          "pointCount": len(node.points), "payload": payload}},
                upsert=True,
            )
        )
        nodes_header[node.key] = {
            "bounds": {"min": [round(v, 6) for v in node.bounds_lo],
                       "max": [round(v, 6) for v in node.bounds_hi]},
            "childMask": child_mask,
            "pointCount": len(node.points),
            "depth": node.depth,
        }
        node_count += 1
        point_check += len(node.points)

    if point_check != len(papers):
        print(f"[tiles] WARN: stored {point_check} points, expected {len(papers)}")

    tree = {
        "root": "r",
        "bbox": {"min": [round(v, 6) for v in bbox_lo], "max": [round(v, 6) for v in bbox_hi]},
        "gridRes": GRID_RES,
        "capacity": capacity,
        "nodes": nodes_header,
    }
    dict_doc = {
        "themes": themes,
        "domains": domains,
        "themeAnchors": _anchors(papers, ["theme"]),
        "domainAnchors": _anchors(papers, ["theme", "domain"]),
    }

    client = MongoClient(mongo_uri)
    db = client.get_default_database()
    if db is None:
        db = client["research_ambit"]

    print(f"[tiles] writing {node_count:,} tiles ({point_check:,} points) to Mongo ...")
    db.atlas_tiles.create_index([("version", 1), ("nodeKey", 1)], unique=True)
    # Clean any partial write for this version, then bulk upsert.
    db.atlas_tiles.delete_many({"version": version})
    CHUNK = 500
    for i in range(0, len(tile_ops), CHUNK):
        db.atlas_tiles.bulk_write(tile_ops[i:i + CHUNK], ordered=False)

    # Searchable point rows (exact coords + text) — powers server-side atlas
    # search and the highlight overlay without ever loading the cloud into RAM.
    print(f"[tiles] writing {len(papers):,} atlas_points ...")
    db.atlas_points.create_index([("version", 1), ("i", 1)], unique=True)
    db.atlas_points.delete_many({"version": version})
    point_ops = []
    for p in papers:
        point_ops.append(
            UpdateOne(
                {"version": version, "i": p["i"]},
                {"$set": {
                    "version": version, "i": p["i"], "id": p.get("id", ""),
                    "title": p.get("title", ""), "theme": p.get("theme", ""),
                    "domain": p.get("domain", ""), "subdomain": p.get("subdomain", ""),
                    "topic": p.get("topic", ""), "department": p.get("department", ""),
                    "citations": int(p.get("citations", 0) or 0),
                    "x": p["x"], "y": p["y"], "z": p["z"],
                }},
                upsert=True,
            )
        )
        if len(point_ops) >= 1000:
            db.atlas_points.bulk_write(point_ops, ordered=False)
            point_ops = []
    if point_ops:
        db.atlas_points.bulk_write(point_ops, ordered=False)
    try:
        db.atlas_points.create_index(
            [("title", "text"), ("theme", "text"), ("domain", "text"),
             ("subdomain", "text"), ("topic", "text")],
            name="atlas_point_text",
            weights={"title": 5, "topic": 4, "subdomain": 3, "domain": 2, "theme": 1},
        )
    except Exception as exc:  # index may already exist with same spec
        print(f"[tiles] text index note: {exc}")

    db.atlas_meta.update_one(
        {"_id": version},
        {"$set": {"_id": version, "kind": "version", "version": version,
                  "pointCount": len(papers), "tree": tree, "dict": dict_doc,
                  "createdAt": time.time()}},
        upsert=True,
    )
    # Atomic cutover.
    db.atlas_meta.update_one(
        {"_id": "active"},
        {"$set": {"_id": "active", "kind": "pointer", "version": version}},
        upsert=True,
    )
    print(f"[tiles] active version -> {version}")

    _gc_old_versions(db, keep_current=version)
    client.close()
    return version


def _gc_old_versions(db, keep_current):
    versions = [d["_id"] for d in db.atlas_meta.find({"kind": "version"}, {"_id": 1})
                .sort("createdAt", -1)]
    stale = versions[KEEP_VERSIONS:]
    stale = [v for v in stale if v != keep_current]
    if not stale:
        return
    print(f"[tiles] GC {len(stale)} old version(s): {stale}")
    db.atlas_tiles.delete_many({"version": {"$in": stale}})
    db.atlas_points.delete_many({"version": {"$in": stale}})
    db.atlas_meta.delete_many({"_id": {"$in": stale}, "kind": "version"})
    db.kg_faculty_graphs.delete_many({"version": {"$in": stale}})
    db.kg_explore.delete_many({"version": {"$in": stale}})
    db.kg_indices.delete_many({"version": {"$in": stale}})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--atlas", default=str(DEFAULT_ATLAS))
    ap.add_argument("--capacity", type=int, default=DEFAULT_CAPACITY)
    ap.add_argument("--mongo-uri", default=None)
    args = ap.parse_args()
    t0 = time.time()
    version = build_atlas_tiles(args.atlas, args.capacity, args.mongo_uri)
    print(f"[tiles] done in {time.time() - t0:.1f}s (version {version})")


if __name__ == "__main__":
    sys.exit(main())
