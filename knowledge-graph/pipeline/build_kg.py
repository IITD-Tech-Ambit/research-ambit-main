"""
build_kg.py — Atlas builder for Research Ambit (IIT Delhi).

Data sources
------------
1. classification/Copy of Classified_DataSheet.xlsx — 5-level classification
     Columns: Title, Broad_Theme, IITD_Department, Domain, Sub_Domain, Topic
     (~66,235 unique papers after deduplicating by internal paper id)
2. MongoDB (READ-ONLY) — paper metadata: citation_count, year + faculty mapping
     Collections: researchmetadatascopus, faculties, departments

All classification (node labels) comes from the Excel columns exactly.
No BGE, no HDBSCAN, no KeyBERT.

Node types (matching Excel column names)
---------
  faculty   → blue     Faculty member
  paper     → green    Individual paper
  theme     → red      Broad_Theme   (Level 1, 9 values)
  domain    → purple   Domain        (Level 3, ~35 values)
  subdomain → orange   Sub_Domain    (Level 4, ~176 values)
  topic     → yellow   Topic         (Level 5, YAKE keyphrase)

Edges
-----
  faculty  → AUTHORED      → paper
  paper    → BELONGS_TO    → theme      (Broad_Theme)
  paper    → IN_DOMAIN     → domain     (Domain)
  paper    → IN_SUBDOMAIN  → subdomain  (Sub_Domain)
  paper    → HAS_TOPIC     → topic      (Topic)

Output
------
  output/graphs/<facultyId>.json   one graph per faculty
  output/graphs/index.json         [{facultyId, name, department, ...}]

Usage (PowerShell — run from knowledge-graph/pipeline)
------
  python -u build_kg.py
"""

from __future__ import annotations

import json
import re
import sys
import time
from collections import defaultdict
from pathlib import Path

import pandas as pd
from bson import ObjectId
from pymongo import MongoClient

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
ROOT           = Path(__file__).resolve().parent.parent          # knowledge-graph/
PROJECT_ROOT   = ROOT.parent                                   # research-ambit-main/
EXCEL_PAPERS   = ROOT / "classification" / "Copy of Classified_DataSheet.xlsx"
EXCEL_FACULTY  = ROOT / "classification" / "List of IITD Faculty members 2025.xlsx"
OUTPUT_DIR     = PROJECT_ROOT / "data" / "knowledge-graph"
GRAPHS_DIR     = OUTPUT_DIR / "graphs"
EXPLORE_INDEX  = OUTPUT_DIR / "explore_index.json"

CLASSIFICATION_COLS = [
    "Title", "Broad_Theme", "IITD_Department", "Domain", "Sub_Domain", "Topic",
]
# Read from Excel for matching only — never written to graph/atlas/API output.
_PAPER_ID_COL = "MongoDB_ID"

# Load .env from project root (MONGO_URI)
try:
    from dotenv import load_dotenv
    load_dotenv(PROJECT_ROOT / ".env")
except ImportError:
    pass

import os
MONGO_URI = os.environ.get("MONGO_URI") or os.environ.get("KG_MONGO_URI", "")

OUTPUT_DIR.mkdir(exist_ok=True)
GRAPHS_DIR.mkdir(exist_ok=True)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _norm(text: str | None) -> str:
    """Normalize a title for matching: lowercase, strip punctuation/whitespace."""
    if not text:
        return ""
    t = text.lower()
    t = re.sub(r"[^a-z0-9\s]", " ", t)
    return re.sub(r"\s+", " ", t).strip()


# ---------------------------------------------------------------------------
# Step 1 — Load Excel classification map
# ---------------------------------------------------------------------------
def load_classification() -> dict[str, dict]:
    """
    Returns  paper_id → {title, broad_theme, iitd_dept, domain, sub_domain, topic}
    Reads all sheets; keeps one row per paper id (first row wins on duplicates).
    """
    print(f"[build_kg] reading {EXCEL_PAPERS.name} …")
    t0 = time.perf_counter()

    frames = []
    xl = pd.ExcelFile(EXCEL_PAPERS)
    for sheet in xl.sheet_names:
        df = xl.parse(sheet, usecols=lambda c: c in CLASSIFICATION_COLS or c == _PAPER_ID_COL)
        missing = [c for c in CLASSIFICATION_COLS if c not in df.columns]
        if missing:
            raise ValueError(f"Sheet '{sheet}' missing columns: {missing}")
        if _PAPER_ID_COL not in df.columns:
            raise ValueError(f"Sheet '{sheet}' missing required column: {_PAPER_ID_COL}")
        frames.append(df)

    combined = pd.concat(frames, ignore_index=True)
    combined.fillna("", inplace=True)

    mapping: dict[str, dict] = {}
    excel_rows = len(combined)
    skipped_dup = 0
    for _, row in combined.iterrows():
        paper_id = str(row[_PAPER_ID_COL]).strip()
        if not paper_id:
            continue
        if paper_id in mapping:
            skipped_dup += 1
            continue
        title = str(row["Title"]).strip() or "Untitled"
        mapping[paper_id] = {
            "title":       title,
            "broad_theme": str(row["Broad_Theme"]).strip()     or "Unknown Theme",
            "iitd_dept":   str(row["IITD_Department"]).strip() or "Unknown Dept",
            "domain":      str(row["Domain"]).strip()         or "Unknown Domain",
            "sub_domain":  str(row["Sub_Domain"]).strip()      or "Unknown Sub-Domain",
            "topic":       str(row["Topic"]).strip()           or "Research Topic",
        }

    print(f"[build_kg]   {excel_rows:,} Excel rows -> {len(mapping):,} unique papers "
          f"({skipped_dup:,} duplicate rows skipped) in "
          f"{time.perf_counter()-t0:.1f}s")
    return mapping


# ---------------------------------------------------------------------------
# Step 2 — Load faculty members from Excel
# ---------------------------------------------------------------------------
def load_faculty_excel() -> dict[str, list[str]]:
    """
    Returns dept_name → [faculty_name, …]
    """
    print(f"[build_kg] reading {EXCEL_FACULTY.name} …")
    df = pd.read_excel(EXCEL_FACULTY)
    dept_map: dict[str, list[str]] = defaultdict(list)
    for _, row in df.iterrows():
        name = str(row.get("Employee Name", "")).strip()
        dept = str(row.get("Department", "")).strip()
        if name and dept:
            dept_map[dept].append(name)
    total = sum(len(v) for v in dept_map.values())
    print(f"[build_kg]   {total} faculty across {len(dept_map)} departments loaded")
    return dict(dept_map)


# ---------------------------------------------------------------------------
# Step 3 — MongoDB: paper metadata + faculty→paper mapping
# ---------------------------------------------------------------------------
PAPER_COLLECTION_CANDIDATES = [
    "researchmetadatascopus", "researchmetadatascopuses",
    "researchmetadatascopus", "research_scopus", "papers",
]
FACULTY_COLLECTION_CANDIDATES = ["faculties", "faculty"]


def _resolve_collections(client: MongoClient):
    candidate_dbs = [d for d in client.list_database_names()
                     if d not in ("admin", "local", "config")]
    for dbn in candidate_dbs:
        names = set(client[dbn].list_collection_names())
        p = next((c for c in PAPER_COLLECTION_CANDIDATES if c in names), None)
        if not p:
            continue
        f = next((c for c in FACULTY_COLLECTION_CANDIDATES if c in names), None)
        return dbn, p, f
    raise RuntimeError(
        "Could not auto-detect papers collection in MongoDB. "
        "Set KG_DB_NAME and KG_PAPERS_COLLECTION in .env."
    )


def load_mongo_data(classification: dict[str, dict]) -> tuple[list[dict], dict, dict]:
    """
    Connects to MongoDB (read-only) and returns:
      papers      — one MongoDB document per unique classified paper
      scopus_map  — scopus_author_id → faculty_record
      kerb_map    — kerberos         → faculty_record
    """
    paper_ids = set(classification.keys())
    print(f"[build_kg] connecting to MongoDB …")
    client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=10_000)
    try:
        db_name, papers_coll, faculty_coll = _resolve_collections(client)
        print(f"[build_kg]   DB={db_name}  papers={papers_coll}  faculty={faculty_coll}")
        db = client[db_name]

        # --- Departments ---
        dept_names: dict[str, str] = {}
        for cand in ("departments", "department"):
            if cand in db.list_collection_names():
                for d in db[cand].find({}, {"name": 1, "department_name": 1}):
                    dept_names[str(d["_id"])] = (
                        d.get("name") or d.get("department_name") or ""
                    )
                break

        # --- Faculty ---
        scopus_map: dict[str, dict] = {}
        kerb_map:   dict[str, dict] = {}
        if faculty_coll:
            fac_docs = list(db[faculty_coll].find({}, {
                "title": 1, "firstName": 1, "lastName": 1,
                "email": 1, "scopus_id": 1, "department": 1,
                "citation_count": 1,
            }))
            for f in fac_docs:
                fid  = str(f["_id"])
                name = " ".join(
                    str(x) for x in [f.get("title"), f.get("firstName"), f.get("lastName")]
                    if x
                ).strip()
                rec = {
                    "facultyId":    fid,
                    "name":         name or "Unknown Faculty",
                    "department":   dept_names.get(str(f.get("department")), ""),
                    "citation_count": int(f.get("citation_count") or 0),
                    "scopus_ids":   [str(s) for s in (f.get("scopus_id") or [])],
                }
                for sid in rec["scopus_ids"]:
                    if sid:
                        scopus_map[sid] = rec
                email = (f.get("email") or "").strip().lower()
                if "@" in email:
                    kerb_map[email.split("@")[0]] = rec
            print(f"[build_kg]   {len(fac_docs)} faculty  "
                  f"| {len(scopus_map)} scopus IDs  "
                  f"| {len(kerb_map)} kerberos keys")

        # --- Papers (Excel-listed only) ---
        fields = {
            "title": 1, "authors": 1,
            "citation_count": 1, "publication_year": 1,
            "kerberos": 1, "link": 1,
            "document_scopus_id": 1, "document_eid": 1,
        }
        oids: list[ObjectId] = []
        for pid in paper_ids:
            try:
                oids.append(ObjectId(pid))
            except Exception:
                pass

        print(f"[build_kg]   fetching {len(oids):,} classified papers from {papers_coll} …")
        papers: list[dict] = []
        batch_size = 2000
        for i in range(0, len(oids), batch_size):
            batch = oids[i:i + batch_size]
            for doc in db[papers_coll].find({"_id": {"$in": batch}}, fields):
                doc["_id"] = str(doc["_id"])
                papers.append(doc)

        missing = len(paper_ids) - len(papers)
        if missing:
            print(f"[build_kg]   WARNING: {missing:,} classified papers not found in MongoDB")
        print(f"[build_kg]   {len(papers):,} papers loaded from MongoDB")

        return papers, scopus_map, kerb_map
    finally:
        client.close()


# ---------------------------------------------------------------------------
# Step 4 — Assign papers to faculties
# ---------------------------------------------------------------------------
def assign_papers_to_faculty(
    papers: list[dict],
    scopus_map: dict,
    kerb_map: dict,
) -> dict[str, list]:
    """Returns {facultyId: [(faculty_rec, paper_doc), …]}"""
    faculty_papers: dict[str, list] = defaultdict(list)
    for p in papers:
        owners: dict[str, dict] = {}
        for a in p.get("authors", []):
            sid = (a.get("author_id") or "").strip()
            if sid in scopus_map:
                fac = scopus_map[sid]
                owners[fac["facultyId"]] = fac
        kerb = (p.get("kerberos") or "").strip().lower()
        if kerb in kerb_map:
            fac = kerb_map[kerb]
            owners[fac["facultyId"]] = fac
        for fid, fac in owners.items():
            faculty_papers[fid].append((fac, p))
    return dict(faculty_papers)


# ---------------------------------------------------------------------------
# Step 5 — Build graph per faculty
# ---------------------------------------------------------------------------
def build_faculty_graph(
    faculty: dict,
    papers: list[dict],
    classification: dict[str, dict],
) -> dict:
    nodes: dict[str, dict] = {}
    edges: list[dict] = []

    def add_node(nid: str, label: str, ntype: str, **extra):
        if nid not in nodes:
            nodes[nid] = {"id": nid, "label": label, "type": ntype, **extra}

    # Faculty root
    fid = f"f:{faculty['facultyId']}"
    add_node(fid, faculty["name"], "faculty",
             department=faculty.get("department", ""),
             citation_count=faculty.get("citation_count", 0))

    matched = 0
    for p in papers:
        pid   = f"p:{p['_id']}"
        cls   = classification.get(str(p["_id"]))
        if not cls:
            continue

        matched += 1
        title = (p.get("title") or cls.get("title") or "Untitled").strip()
        broad_theme = cls["broad_theme"]
        domain      = cls["domain"]
        sub_domain  = cls["sub_domain"]
        topic       = cls["topic"]
        iitd_dept   = cls.get("iitd_dept") or ""

        add_node(pid, title, "paper",
                 citation_count=int(p.get("citation_count") or 0),
                 year=p.get("publication_year"),
                 broad_theme=broad_theme,
                 domain=domain,
                 sub_domain=sub_domain,
                 topic=topic,
                 iitd_department=iitd_dept,
                 link=(p.get("link") or "").strip(),
                 document_scopus_id=(p.get("document_scopus_id") or "").strip(),
                 document_eid=(p.get("document_eid") or "").strip())
        edges.append({"source": fid, "target": pid, "label": "AUTHORED"})

        # Level 1 — Broad Theme
        if broad_theme and broad_theme != "Unclassified":
            tid = f"theme:{broad_theme}"
            add_node(tid, broad_theme, "theme")
            edges.append({"source": pid, "target": tid, "label": "BELONGS_TO"})

        # Level 3 — Domain
        if domain and domain not in ("Unclassified", "Unknown Domain"):
            did = f"dom:{domain}"
            add_node(did, domain, "domain")
            edges.append({"source": pid, "target": did, "label": "IN_DOMAIN"})

        # Level 4 — Sub-Domain
        if sub_domain and sub_domain != "Unclassified":
            sdid = f"sd:{sub_domain}"
            add_node(sdid, sub_domain, "subdomain")
            edges.append({"source": pid, "target": sdid, "label": "IN_SUBDOMAIN"})

        # Level 5 — Topic (YAKE keyphrase from Excel)
        if topic:
            topid = f"topic:{topic}"
            add_node(topid, topic, "topic")
            edges.append({"source": pid, "target": topid, "label": "HAS_TOPIC"})

    return {"nodes": list(nodes.values()), "edges": edges, "_matched": matched}


# ---------------------------------------------------------------------------
# Explore index — reverse lookup: term → departments → faculty
# ---------------------------------------------------------------------------
def build_explore_index(
    faculty_papers: dict[str, list],
    classification: dict[str, dict],
) -> dict:
    """
    Builds a reverse index for the Topic Explorer:

        term (theme | domain | subdomain | topic)
          → departments (that have professors publishing on this term)
            → professors (faculty) with their paper counts
    """
    def _term_tree():
        return defaultdict(lambda: defaultdict(lambda: defaultdict(
            lambda: {"name": "", "papers": 0})))

    agg = {
        "theme": _term_tree(),
        "domain": _term_tree(),
        "subdomain": _term_tree(),
        "topic": _term_tree(),
    }

    for fid, pairs in faculty_papers.items():
        faculty = pairs[0][0]
        dept = (faculty.get("department") or "Unknown Department").strip() or "Unknown Department"
        fname = faculty.get("name", "Unknown Faculty")

        for _f, p in pairs:
            cls = classification.get(str(p["_id"]))
            if not cls:
                continue
            pairs_to_add = [
                ("theme",     cls["broad_theme"]),
                ("domain",    cls["domain"]),
                ("subdomain", cls["sub_domain"]),
                ("topic",     cls["topic"]),
            ]
            for typ, term in pairs_to_add:
                term = (term or "").strip()
                if not term or term in ("Unclassified", "Research Topic", "Unknown Theme",
                                        "Unknown Domain", "Unknown Sub-Domain", "Unknown Dept"):
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
                departments.append({
                    "department": dept,
                    "paperCount": dept_papers,
                    "facultyCount": len(faculty_list),
                    "faculty": faculty_list,
                })
                term_papers += dept_papers
                term_faculty += len(faculty_list)
            departments.sort(key=lambda x: -x["paperCount"])

            key = f"{typ}::{term}"
            detail[key] = {"term": term, "type": typ, "departments": departments}
            terms.append({
                "key": key, "term": term, "type": typ,
                "paperCount": term_papers,
                "deptCount": len(departments),
                "facultyCount": term_faculty,
            })

    type_order = {"theme": 0, "domain": 1, "subdomain": 2, "topic": 3}
    terms.sort(key=lambda t: (type_order[t["type"]], -t["paperCount"]))

    return {"terms": terms, "detail": detail}


def write_atlas_source(papers: list[dict], classification: dict[str, dict]) -> int:
    """Write every Excel-listed paper for atlas (includes papers with no faculty match)."""
    catalog = []
    for p in papers:
        cls = classification.get(str(p["_id"]))
        if not cls:
            continue
        catalog.append({
            "id": str(p["_id"]),
            "title": (p.get("title") or cls.get("title") or "Untitled").strip(),
            "broad_theme": cls["broad_theme"],
            "domain": cls["domain"],
            "sub_domain": cls["sub_domain"],
            "topic": cls["topic"],
            "iitd_department": cls.get("iitd_dept") or "",
            "citation_count": int(p.get("citation_count") or 0),
            "year": p.get("publication_year"),
        })
    with open(OUTPUT_DIR / "atlas_papers_source.json", "w", encoding="utf-8") as f:
        json.dump(catalog, f, ensure_ascii=False)
    return len(catalog)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    t_total = time.perf_counter()
    print("=" * 60)
    print("Research Ambit — Atlas Builder (Excel-based)")
    print("=" * 60)

    classification = load_classification()

    # Remove stale faculty graphs from prior runs (atlas scans every *.json here).
    stale = 0
    for old_graph in GRAPHS_DIR.glob("*.json"):
        if old_graph.name != "index.json":
            old_graph.unlink()
            stale += 1
    if stale:
        print(f"[build_kg] cleared {stale} stale faculty graph files")

    papers, scopus_map, kerb_map = load_mongo_data(classification)

    faculty_papers = assign_papers_to_faculty(papers, scopus_map, kerb_map)
    print(f"\n[build_kg] {len(faculty_papers)} faculties matched to sampled papers")

    if not faculty_papers:
        print("[build_kg] ERROR: no papers matched any faculty. "
              "Check scopus_id / kerberos overlap.")
        sys.exit(1)

    index = []
    total_matched = 0

    for fid, pairs in faculty_papers.items():
        faculty    = pairs[0][0]
        fac_papers = [p for _f, p in pairs]
        graph      = build_faculty_graph(faculty, fac_papers, classification)
        matched    = graph.pop("_matched", 0)
        total_matched += matched

        out_path = GRAPHS_DIR / f"{fid}.json"
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(graph, f, ensure_ascii=False)

        index.append({
            "facultyId":  fid,
            "name":       faculty["name"],
            "department": faculty.get("department", ""),
            "paperCount": len(fac_papers),
            "nodeCount":  len(graph["nodes"]),
            "edgeCount":  len(graph["edges"]),
            "classified": matched,
        })

    index.sort(key=lambda x: -x["paperCount"])

    with open(GRAPHS_DIR / "index.json", "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)

    print("\n[build_kg] building explore index (term -> departments -> faculty) ...")
    explore = build_explore_index(faculty_papers, classification)
    with open(EXPLORE_INDEX, "w", encoding="utf-8") as f:
        json.dump(explore, f, ensure_ascii=False)
    print(f"[build_kg]   {len(explore['terms'])} searchable terms "
          f"(themes/domains/sub-domains/topics) -> {EXPLORE_INDEX.name}")

    print("\n[build_kg] building 3D atlas layout (classified papers only) ...")
    source_count = write_atlas_source(papers, classification)
    print(f"[build_kg]   {source_count:,} classified papers -> atlas_papers_source.json")
    from build_atlas import build_atlas as _build_atlas_payload
    from build_atlas import ATLAS_FILE as _ATLAS_FILE
    atlas = _build_atlas_payload(classified_only=True)
    with open(_ATLAS_FILE, "w", encoding="utf-8") as f:
        json.dump(atlas, f, ensure_ascii=False, separators=(",", ":"))
    print(f"[build_kg]   {atlas['count']:,} papers -> {_ATLAS_FILE.name}")

    # Publish everything straight to MongoDB (the runtime no longer reads the
    # filesystem): octree LOD tiles first (sets the active version), then the
    # rest of the KG data under that same version. Skips cleanly if MONGO_URI is
    # unset so the pure-file build still works offline.
    if MONGO_URI:
        print("\n[build_kg] publishing atlas octree tiles to MongoDB ...")
        from build_atlas_tiles import build_atlas_tiles as _build_tiles
        from migrate_kg_to_mongo import migrate as _migrate_kg
        _version = _build_tiles(_ATLAS_FILE, mongo_uri=MONGO_URI)
        print(f"[build_kg]   atlas tiles published (version {_version})")
        print("[build_kg] migrating graphs / explore / indices to MongoDB ...")
        _migrate_kg(OUTPUT_DIR, version_override=_version, mongo_uri=MONGO_URI)
        print(f"[build_kg]   KG data published to MongoDB (version {_version})")
    else:
        print("\n[build_kg] MONGO_URI unset — skipped MongoDB publish "
              "(run build_atlas_tiles.py + migrate_kg_to_mongo.py manually)")

    total_papers = sum(i["paperCount"] for i in index)
    match_pct    = 100 * total_matched / max(total_papers, 1)
    elapsed      = time.perf_counter() - t_total

    print(f"\n{'='*60}")
    print(f"DONE — {len(index)} faculty graphs | {total_papers} paper-links")
    print(f"Excel classification: {total_matched}/{total_papers} ({match_pct:.1f}%) matched")
    print(f"Atlas papers (classified only): {atlas['count']:,}")
    print(f"Total time: {elapsed:.1f}s")
    print(f"Output: {GRAPHS_DIR}")
    print(f"{'='*60}\n")
    print(f"{'Faculty':<32} {'Papers':>6} {'Nodes':>6} {'Classified':>10}")
    print("-" * 58)
    for i in index[:15]:
        print(f"{i['name']:<32} {i['paperCount']:>6} {i['nodeCount']:>6} "
              f"{i['classified']:>10}")
    if len(index) > 15:
        print(f"  … and {len(index)-15} more faculty")


if __name__ == "__main__":
    main()
