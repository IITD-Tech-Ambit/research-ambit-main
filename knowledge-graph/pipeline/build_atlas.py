"""
build_atlas.py — 3D Research Atlas layout for all classified papers.

Reads per-faculty graph JSON files produced by build_kg.py, deduplicates paper
nodes, assigns deterministic 3D coordinates (theme clusters on a sphere with
sub-domain / topic jitter), and writes atlas_papers.json for the frontend.

Usage (from research-ambit-main/knowledge-graph):
  python pipeline/build_atlas.py
"""

from __future__ import annotations

import hashlib
import json
import math
import random
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROJECT_ROOT = ROOT.parent
GRAPHS_DIR = PROJECT_ROOT / "data" / "knowledge-graph" / "graphs"
ATLAS_FILE = PROJECT_ROOT / "data" / "knowledge-graph" / "atlas_papers.json"
FACULTY_INDICES_FILE = PROJECT_ROOT / "data" / "knowledge-graph" / "atlas_faculty_indices.json"


def _fibonacci_sphere(i: int, n: int, radius: float = 1.0) -> tuple[float, float, float]:
    """Evenly distribute n points on a sphere."""
    if n <= 1:
        return 0.0, 0.0, radius
    phi = math.pi * (3.0 - math.sqrt(5.0))
    y = 1.0 - (i / float(n - 1)) * 2.0
    r = math.sqrt(max(0.0, 1.0 - y * y))
    theta = phi * i
    return math.cos(theta) * r * radius, y * radius, math.sin(theta) * r * radius


def _seed_rng(key: str) -> random.Random:
    digest = hashlib.md5(key.encode("utf-8")).hexdigest()
    return random.Random(int(digest[:8], 16))


def _paper_position(
    paper: dict,
    theme_index: dict[str, int],
    theme_count: int,
) -> tuple[float, float, float]:
    theme = paper.get("broad_theme") or "Unknown Theme"
    subdomain = paper.get("sub_domain") or "Unknown Sub-Domain"
    topic = paper.get("topic") or "Research Topic"
    paper_id = paper.get("id") or paper.get("label") or ""

    ti = theme_index.get(theme, 0)
    cx, cy, cz = _fibonacci_sphere(ti, theme_count, 0.62)

    sd_rng = _seed_rng(f"sd:{subdomain}")
    jx = (sd_rng.random() - 0.5) * 0.42
    jy = (sd_rng.random() - 0.5) * 0.42
    jz = (sd_rng.random() - 0.5) * 0.42

    tp_rng = _seed_rng(f"tp:{topic}")
    tx = (tp_rng.random() - 0.5) * 0.18
    ty = (tp_rng.random() - 0.5) * 0.18
    tz = (tp_rng.random() - 0.5) * 0.18

    id_rng = _seed_rng(f"id:{paper_id}")
    px = (id_rng.random() - 0.5) * 0.08
    py = (id_rng.random() - 0.5) * 0.08
    pz = (id_rng.random() - 0.5) * 0.08

    x, y, z = cx + jx + tx + px, cy + jy + ty + py, cz + jz + tz + pz

    # Pull toward centre for the dense “galaxy core” look.
    dist = math.sqrt(x * x + y * y + z * z) or 1.0
    pull = 0.72 + id_rng.random() * 0.38
    x *= pull / dist
    y *= pull / dist
    z *= pull / dist
    return round(x, 5), round(y, 5), round(z, 5)


def collect_papers() -> dict[str, dict]:
    papers: dict[str, dict] = {}
    if not GRAPHS_DIR.exists():
        raise FileNotFoundError(f"Graphs directory not found: {GRAPHS_DIR}")

    for path in sorted(GRAPHS_DIR.glob("*.json")):
        if path.name == "index.json":
            continue
        graph = json.loads(path.read_text(encoding="utf-8"))
        for node in graph.get("nodes", []):
            if node.get("type") != "paper":
                continue
            pid = node["id"].removeprefix("p:")
            if pid in papers:
                continue
            papers[pid] = {
                "id": pid,
                "title": node.get("label") or "",
                "broad_theme": node.get("broad_theme") or "",
                "sub_domain": node.get("sub_domain") or "",
                "topic": node.get("topic") or "",
                "citation_count": int(node.get("citation_count") or 0),
                "year": node.get("year"),
            }
    return papers


def build_atlas() -> dict:
    papers_map = collect_papers()
    themes = sorted({p["broad_theme"] for p in papers_map.values() if p["broad_theme"]})
    theme_index = {t: i for i, t in enumerate(themes)}

    items = []
    for idx, paper in enumerate(sorted(papers_map.values(), key=lambda p: p["id"])):
        x, y, z = _paper_position(paper, theme_index, len(themes))
        items.append({
            "i": idx,
            "id": paper["id"],
            "title": paper["title"],
            "theme": paper["broad_theme"],
            "subdomain": paper["sub_domain"],
            "topic": paper["topic"],
            "citations": paper["citation_count"],
            "x": x,
            "y": y,
            "z": z,
        })

    return {
        "version": 1,
        "count": len(items),
        "themes": themes,
        "papers": items,
        "paperIdToIndex": {p["id"]: p["i"] for p in items},
    }


def build_faculty_indices(paper_id_to_index: dict[str, int]) -> dict:
    """Map each faculty graph to atlas paper indices for name search."""
    by_faculty: dict[str, list[int]] = {}

    if not GRAPHS_DIR.exists():
        return {"version": 1, "facultyCount": 0, "byFacultyId": {}}

    for path in sorted(GRAPHS_DIR.glob("*.json")):
        if path.name == "index.json":
            continue
        faculty_id = path.stem
        graph = json.loads(path.read_text(encoding="utf-8"))
        indices: set[int] = set()
        for node in graph.get("nodes", []):
            if node.get("type") != "paper":
                continue
            pid = node["id"].removeprefix("p:")
            idx = paper_id_to_index.get(pid)
            if idx is not None:
                indices.add(idx)
        if indices:
            by_faculty[faculty_id] = sorted(indices)

    return {"version": 1, "facultyCount": len(by_faculty), "byFacultyId": by_faculty}


def main() -> None:
    t0 = time.perf_counter()
    print("[build_atlas] scanning faculty graphs …")
    atlas = build_atlas()
    ATLAS_FILE.parent.mkdir(parents=True, exist_ok=True)
    paper_id_to_index = atlas.pop("paperIdToIndex", {})
    with open(ATLAS_FILE, "w", encoding="utf-8") as f:
        json.dump(atlas, f, ensure_ascii=False, separators=(",", ":"))

    print("[build_atlas] building faculty paper index …")
    faculty_indices = build_faculty_indices(paper_id_to_index)
    with open(FACULTY_INDICES_FILE, "w", encoding="utf-8") as f:
        json.dump(faculty_indices, f, ensure_ascii=False, separators=(",", ":"))

    elapsed = time.perf_counter() - t0
    size_mb = ATLAS_FILE.stat().st_size / (1024 * 1024)
    fac_mb = FACULTY_INDICES_FILE.stat().st_size / (1024 * 1024)
    print(
        f"[build_atlas] {atlas['count']:,} papers -> {ATLAS_FILE.name} ({size_mb:.1f} MB, {elapsed:.1f}s)"
    )
    print(
        f"[build_atlas] {faculty_indices['facultyCount']:,} faculty -> "
        f"{FACULTY_INDICES_FILE.name} ({fac_mb:.1f} MB)"
    )


if __name__ == "__main__":
    main()
