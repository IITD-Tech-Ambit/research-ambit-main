"""
build_kg_from_classification.py — Atlas / Knowledge-Graph builder driven by the
in-database `classification` field (replaces the old Excel-based build_kg.py).

Taxonomy source (MongoDB, READ-ONLY here)
-----------------------------------------
Every researchmetadatascopus doc now carries::

    classification: {
        thematic_area_id: ObjectId -> thematicareas._id   (9 themes)
        domain_id:        ObjectId -> domains._id          (80 domains)
        subdomain_id:     null                             (no sub-domains yet)
        topics:           []                               (no topics yet)
        unclassifiable:   bool
    }

and IITD authorship is resolved directly via::

    iitd_authors: [{ faculty_ref -> faculties._id, department_ref -> departments._id }]

So this build is a 2-level taxonomy: theme -> domain. `subdomain`/`topic` are
emitted as empty strings to stay schema-compatible with the runtime (atlas_points
/ tiles / explore) which still has those columns.

Outputs (LOCAL files only — no DB writes happen in this script)
---------------------------------------------------------------
  data/knowledge-graph/graphs/<facultyId>.json   one graph per faculty
  data/knowledge-graph/graphs/index.json         faculty search index
  data/knowledge-graph/explore_index.json        term -> departments -> faculty
  data/knowledge-graph/atlas_papers.json         3D point cloud for the atlas
  data/knowledge-graph/atlas_papers_source.json  flat catalog (debug/parity)
  data/knowledge-graph/atlas_faculty_indices.json faculty -> atlas indices

Publishing to MongoDB (atlas_tiles / atlas_points / atlas_meta / kg_*) is done by
the existing build_atlas_tiles.py + migrate_kg_to_mongo.py. Pass --publish to chain
them (writes to the DB — only do this intentionally).

Usage (from research-ambit-main/knowledge-graph/pipeline)
------
  python build_kg_from_classification.py                 # local files only
  python build_kg_from_classification.py --publish       # ALSO writes to Mongo
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import random
import sys
import time
from collections import defaultdict
from pathlib import Path

from pymongo import MongoClient

ROOT = Path(__file__).resolve().parent.parent            # knowledge-graph/
PROJECT_ROOT = ROOT.parent                               # research-ambit-main/
OUTPUT_DIR = PROJECT_ROOT / "data" / "knowledge-graph"
GRAPHS_DIR = OUTPUT_DIR / "graphs"
EXPLORE_INDEX = OUTPUT_DIR / "explore_index.json"
ATLAS_FILE = OUTPUT_DIR / "atlas_papers.json"
ATLAS_SOURCE_FILE = OUTPUT_DIR / "atlas_papers_source.json"
FACULTY_INDICES_FILE = OUTPUT_DIR / "atlas_faculty_indices.json"

UNCLASSIFIED = "Unclassified"

try:
    from dotenv import load_dotenv

    load_dotenv(PROJECT_ROOT / ".env")
except ImportError:
    pass


def _resolve_uri(cli_uri: str | None) -> str:
    uri = (
        cli_uri
        or os.environ.get("MONGO_URI")
        or os.environ.get("KG_MONGO_URI")
        or os.environ.get("MONGODB_URI")
        or ""
    )
    if not uri:
        raise SystemExit(
            "No Mongo connection string. Set MONGODB_URI/MONGO_URI in the .env "
            "or pass --mongo-uri."
        )
    return uri


# ---------------------------------------------------------------------------
# 3D layout (theme cluster on a sphere + per-domain and per-paper jitter)
# ---------------------------------------------------------------------------
def _fibonacci_sphere(i: int, n: int, radius: float = 1.0) -> tuple[float, float, float]:
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


def _paper_position(theme, domain, paper_id, theme_index, theme_count):
    ti = theme_index.get(theme, 0)
    cx, cy, cz = _fibonacci_sphere(ti, theme_count, 0.62)

    # Domain sub-blob offset (bigger range now that sub-domain/topic layers are gone).
    dom_rng = _seed_rng(f"dom:{domain}")
    dx = (dom_rng.random() - 0.5) * 0.34
    dy = (dom_rng.random() - 0.5) * 0.34
    dz = (dom_rng.random() - 0.5) * 0.34

    id_rng = _seed_rng(f"id:{paper_id}")
    px = (id_rng.random() - 0.5) * 0.16
    py = (id_rng.random() - 0.5) * 0.16
    pz = (id_rng.random() - 0.5) * 0.16

    x, y, z = cx + dx + px, cy + dy + py, cz + dz + pz
    dist = math.sqrt(x * x + y * y + z * z) or 1.0
    pull = 0.72 + id_rng.random() * 0.38
    x *= pull / dist
    y *= pull / dist
    z *= pull / dist
    return round(x, 5), round(y, 5), round(z, 5)


# ---------------------------------------------------------------------------
# Load taxonomy + faculty/department reference maps (read-only)
# ---------------------------------------------------------------------------
def load_reference_maps(db):
    def id_name_map(coll):
        return {
            str(d["_id"]): (d.get("name") or "").strip()
            for d in db[coll].find({}, {"name": 1})
        }

    themes = id_name_map("thematicareas")
    domains = id_name_map("domains")
    departments = id_name_map("departments")

    faculty = {}
    for f in db["faculties"].find(
        {}, {"title": 1, "firstName": 1, "lastName": 1, "department": 1, "citation_count": 1}
    ):
        name = " ".join(
            str(x).strip()
            for x in (f.get("title"), f.get("firstName"), f.get("lastName"))
            if x and str(x).strip()
        ).strip()
        faculty[str(f["_id"])] = {
            "facultyId": str(f["_id"]),
            "name": name or "Unknown Faculty",
            "department": departments.get(str(f.get("department")), ""),
            "citation_count": int(f.get("citation_count") or 0),
        }

    print(
        f"[build] taxonomy: {len(themes)} themes, {len(domains)} domains, "
        f"{len(departments)} departments, {len(faculty)} faculty"
    )
    return themes, domains, departments, faculty


# ---------------------------------------------------------------------------
# Load & normalize classified papers (read-only)
# ---------------------------------------------------------------------------
def load_papers(db, themes, domains, departments, include_unclassified, require_iitd_author):
    """Return normalized paper dicts.

    Defaults show every *classified* paper (has a thematic_area_id), regardless of
    whether an IITD author is linked — classified papers with no linked faculty are
    still plotted (department left blank -> the UI treats it as 'Unassigned').
    Unclassified papers are excluded unless include_unclassified is set.
    """
    fields = {
        "title": 1,
        "citation_count": 1,
        "publication_year": 1,
        "link": 1,
        "document_scopus_id": 1,
        "document_eid": 1,
        "classification": 1,
        "iitd_authors": 1,
    }
    query = {}
    if not include_unclassified:
        query["classification.thematic_area_id"] = {"$ne": None}
    if require_iitd_author:
        query["iitd_authors.0"] = {"$exists": True}

    papers = []
    skipped_unclassified = 0
    without_author = 0
    cursor = db["researchmetadatascopus"].find(query, fields).batch_size(2000)
    for doc in cursor:
        cls = doc.get("classification") or {}
        ta_id = cls.get("thematic_area_id")
        dom_id = cls.get("domain_id")
        theme = themes.get(str(ta_id), "") if ta_id else ""
        domain = domains.get(str(dom_id), "") if dom_id else ""

        is_classified = bool(theme)
        if not is_classified:
            if not include_unclassified:
                skipped_unclassified += 1
                continue
            theme = UNCLASSIFIED
            domain = domain or ""

        iitd = doc.get("iitd_authors") or []
        faculty_ids = []
        dept_names = []
        for a in iitd:
            fref = a.get("faculty_ref")
            if fref:
                faculty_ids.append(str(fref))
            dref = a.get("department_ref")
            if dref:
                dn = departments.get(str(dref), "")
                if dn:
                    dept_names.append(dn)
        if not faculty_ids:
            without_author += 1

        papers.append(
            {
                "id": str(doc["_id"]),
                "title": (doc.get("title") or "Untitled").strip(),
                "theme": theme,
                "domain": domain,
                "subdomain": "",
                "topic": "",
                "department": dept_names[0] if dept_names else "",
                "departments": sorted(set(dept_names)),
                "faculty_ids": sorted(set(faculty_ids)),
                "citation_count": int(doc.get("citation_count") or 0),
                "year": doc.get("publication_year"),
                "classified": is_classified,
            }
        )

    print(
        f"[build] {len(papers):,} papers loaded "
        f"({skipped_unclassified:,} unclassified excluded, "
        f"{without_author:,} have no linked IITD faculty)"
    )
    return papers


# ---------------------------------------------------------------------------
# Atlas point cloud
# ---------------------------------------------------------------------------
def build_atlas(papers):
    themes = sorted({p["theme"] for p in papers if p["theme"]})
    theme_index = {t: i for i, t in enumerate(themes)}

    items = []
    for idx, paper in enumerate(sorted(papers, key=lambda p: p["id"])):
        x, y, z = _paper_position(paper["theme"], paper["domain"], paper["id"], theme_index, len(themes))
        items.append(
            {
                "i": idx,
                "id": paper["id"],
                "title": paper["title"],
                "theme": paper["theme"],
                "domain": paper["domain"],
                "subdomain": "",
                "topic": "",
                "department": paper["department"],
                "year": paper["year"],
                "citations": paper["citation_count"],
                "x": x,
                "y": y,
                "z": z,
            }
        )

    paper_id_to_index = {p["id"]: p["i"] for p in items}
    atlas = {"version": 2, "count": len(items), "themes": themes, "papers": items}
    return atlas, paper_id_to_index


# ---------------------------------------------------------------------------
# Per-faculty knowledge graphs
# ---------------------------------------------------------------------------
def build_faculty_graphs(papers, faculty_map):
    faculty_papers = defaultdict(list)
    for p in papers:
        for fid in p["faculty_ids"]:
            faculty_papers[fid].append(p)

    index = []
    for fid, fac_papers in faculty_papers.items():
        faculty = faculty_map.get(fid) or {
            "facultyId": fid,
            "name": "Unknown Faculty",
            "department": "",
            "citation_count": 0,
        }
        nodes = {}
        edges = []

        def add_node(nid, label, ntype, **extra):
            if nid not in nodes:
                nodes[nid] = {"id": nid, "label": label, "type": ntype, **extra}

        froot = f"f:{fid}"
        add_node(
            froot,
            faculty["name"],
            "faculty",
            department=faculty.get("department", ""),
            citation_count=faculty.get("citation_count", 0),
        )

        classified = 0
        for p in fac_papers:
            pid = f"p:{p['id']}"
            add_node(
                pid,
                p["title"],
                "paper",
                citation_count=p["citation_count"],
                year=p["year"],
                broad_theme=p["theme"],
                domain=p["domain"],
                sub_domain="",
                topic="",
                iitd_department=p["department"],
            )
            edges.append({"source": froot, "target": pid, "label": "AUTHORED"})

            if p["theme"] and p["theme"] != UNCLASSIFIED:
                classified += 1
                tid = f"theme:{p['theme']}"
                add_node(tid, p["theme"], "theme")
                edges.append({"source": pid, "target": tid, "label": "BELONGS_TO"})
            if p["domain"]:
                did = f"dom:{p['domain']}"
                add_node(did, p["domain"], "domain")
                edges.append({"source": pid, "target": did, "label": "IN_DOMAIN"})

        graph = {"nodes": list(nodes.values()), "edges": edges}
        GRAPHS_DIR.mkdir(parents=True, exist_ok=True)
        with open(GRAPHS_DIR / f"{fid}.json", "w", encoding="utf-8") as fh:
            json.dump(graph, fh, ensure_ascii=False)

        index.append(
            {
                "facultyId": fid,
                "name": faculty["name"],
                "department": faculty.get("department", ""),
                "paperCount": len(fac_papers),
                "nodeCount": len(nodes),
                "edgeCount": len(edges),
                "classified": classified,
            }
        )

    index.sort(key=lambda x: -x["paperCount"])
    with open(GRAPHS_DIR / "index.json", "w", encoding="utf-8") as fh:
        json.dump(index, fh, ensure_ascii=False, indent=2)
    print(f"[build] {len(index)} faculty graphs written")
    return faculty_papers, index


# ---------------------------------------------------------------------------
# Explore index (term -> departments -> faculty), themes + domains only
# ---------------------------------------------------------------------------
def build_explore_index(faculty_papers, faculty_map):
    def tree():
        return defaultdict(lambda: defaultdict(lambda: defaultdict(lambda: {"name": "", "papers": 0})))

    agg = {"theme": tree(), "domain": tree()}

    for fid, fac_papers in faculty_papers.items():
        faculty = faculty_map.get(fid) or {}
        dept = (faculty.get("department") or "Unknown Department").strip() or "Unknown Department"
        fname = faculty.get("name", "Unknown Faculty")
        for p in fac_papers:
            for typ, term in (("theme", p["theme"]), ("domain", p["domain"])):
                term = (term or "").strip()
                if not term or term == UNCLASSIFIED:
                    continue
                cell = agg[typ][term][dept][fid]
                cell["name"] = fname
                cell["papers"] += 1

    terms = []
    detail = {}
    for typ, term_map in agg.items():
        for term, dept_map in term_map.items():
            departments = []
            term_papers = 0
            term_faculty = 0
            for dept, fac_map in dept_map.items():
                faculty_list = [
                    {"facultyId": fid, "name": c["name"], "paperCount": c["papers"]}
                    for fid, c in fac_map.items()
                ]
                faculty_list.sort(key=lambda x: -x["paperCount"])
                dept_papers = sum(f["paperCount"] for f in faculty_list)
                departments.append(
                    {
                        "department": dept,
                        "paperCount": dept_papers,
                        "facultyCount": len(faculty_list),
                        "faculty": faculty_list,
                    }
                )
                term_papers += dept_papers
                term_faculty += len(faculty_list)
            departments.sort(key=lambda x: -x["paperCount"])
            key = f"{typ}::{term}"
            detail[key] = {"term": term, "type": typ, "departments": departments}
            terms.append(
                {
                    "key": key,
                    "term": term,
                    "type": typ,
                    "paperCount": term_papers,
                    "deptCount": len(departments),
                    "facultyCount": term_faculty,
                }
            )

    type_order = {"theme": 0, "domain": 1}
    terms.sort(key=lambda t: (type_order[t["type"]], -t["paperCount"]))
    with open(EXPLORE_INDEX, "w", encoding="utf-8") as fh:
        json.dump({"terms": terms, "detail": detail}, fh, ensure_ascii=False)
    print(f"[build] explore index: {len(terms)} terms")


# ---------------------------------------------------------------------------
# Faculty -> atlas indices (classified papers only, matches old behavior)
# ---------------------------------------------------------------------------
def build_faculty_indices(papers, paper_id_to_index):
    by_faculty = defaultdict(set)
    for p in papers:
        if not p["classified"]:
            continue
        idx = paper_id_to_index.get(p["id"])
        if idx is None:
            continue
        for fid in p["faculty_ids"]:
            by_faculty[fid].add(idx)
    payload = {
        "version": 1,
        "facultyCount": len(by_faculty),
        "byFacultyId": {fid: sorted(idxs) for fid, idxs in by_faculty.items()},
    }
    with open(FACULTY_INDICES_FILE, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"[build] faculty atlas indices: {payload['facultyCount']} faculty")


def write_atlas_source(papers):
    catalog = [
        {
            "id": p["id"],
            "title": p["title"],
            "broad_theme": p["theme"],
            "domain": p["domain"],
            "sub_domain": "",
            "topic": "",
            "iitd_department": p["department"],
            "citation_count": p["citation_count"],
            "year": p["year"],
        }
        for p in papers
    ]
    with open(ATLAS_SOURCE_FILE, "w", encoding="utf-8") as fh:
        json.dump(catalog, fh, ensure_ascii=False)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mongo-uri", default=None)
    ap.add_argument(
        "--include-unclassified",
        action="store_true",
        help="Also plot unclassifiable papers in an 'Unclassified' cluster (default: excluded).",
    )
    ap.add_argument(
        "--require-iitd-author",
        action="store_true",
        help="Only include papers linked to an IITD faculty (default: show all classified papers).",
    )
    ap.add_argument(
        "--publish",
        action="store_true",
        help="After building local files, publish to MongoDB (WRITES: atlas_tiles/points/meta + kg_*).",
    )
    args = ap.parse_args()

    t0 = time.perf_counter()
    uri = _resolve_uri(args.mongo_uri)
    include_unclassified = args.include_unclassified

    print("=" * 60)
    print("Research Ambit — KG builder (classification-driven, theme + domain)")
    print("=" * 60)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    GRAPHS_DIR.mkdir(parents=True, exist_ok=True)
    # Clear stale per-faculty graphs from any previous run.
    for old in GRAPHS_DIR.glob("*.json"):
        if old.name != "index.json":
            old.unlink()

    client = MongoClient(uri, serverSelectionTimeoutMS=15000)
    try:
        db = client.get_default_database()
        if db is None:
            db = client["research_ambit"]
        print(f"[build] connected, db={db.name}")
        themes, domains, departments, faculty_map = load_reference_maps(db)
        papers = load_papers(
            db, themes, domains, departments,
            include_unclassified, args.require_iitd_author,
        )
    finally:
        client.close()

    if not papers:
        print("[build] ERROR: no papers found")
        sys.exit(1)

    atlas, paper_id_to_index = build_atlas(papers)
    with open(ATLAS_FILE, "w", encoding="utf-8") as fh:
        json.dump(atlas, fh, ensure_ascii=False, separators=(",", ":"))

    write_atlas_source(papers)
    faculty_papers, index = build_faculty_graphs(papers, faculty_map)
    build_explore_index(faculty_papers, faculty_map)
    build_faculty_indices(papers, paper_id_to_index)

    # Summary
    classified = sum(1 for p in papers if p["classified"])
    theme_counts = defaultdict(int)
    for p in papers:
        theme_counts[p["theme"]] += 1
    print(f"\n{'='*60}")
    print(f"LOCAL BUILD DONE in {time.perf_counter()-t0:.1f}s")
    print(f"Atlas points: {atlas['count']:,}  (classified: {classified:,}, "
          f"unclassified: {atlas['count']-classified:,})")
    print(f"Themes ({len(atlas['themes'])}):")
    for t in atlas["themes"]:
        print(f"   {theme_counts[t]:>7,}  {t}")
    print(f"Output dir: {OUTPUT_DIR}")
    print("=" * 60)

    if args.publish:
        print("\n[build] --publish set: writing to MongoDB ...")
        from build_atlas_tiles import build_atlas_tiles
        from migrate_kg_to_mongo import migrate

        version = build_atlas_tiles(ATLAS_FILE, mongo_uri=uri)
        print(f"[build] atlas tiles published (version {version})")
        migrate(OUTPUT_DIR, version_override=version, mongo_uri=uri)
        print(f"[build] KG data published (version {version}) — active pointer flipped")
    else:
        print("\n[build] local-only (no DB writes). Re-run with --publish to go live.")


if __name__ == "__main__":
    main()
