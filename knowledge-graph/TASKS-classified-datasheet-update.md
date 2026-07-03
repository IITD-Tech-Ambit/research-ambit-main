# Knowledge Graph — Domain Migration Plan (New Classification File)

**Source file:** `classification/Copy of Copy of Classified_DataSheet.xlsx`  
**Status:** Completed — 69,092 classified papers in atlas (Excel scope, no unclassified MongoDB papers).

---

## What I found in the new Excel file

| Item | Current pipeline (`classified_all_69k.xlsx`) | New file |
|------|---------------------------------------------|----------|
| **Filename** | `classified_all_69k.xlsx` | `Copy of Copy of Classified_DataSheet.xlsx` |
| **Sheets** | `Classified`, `Admin_Fallback` | **`Classified (1)` only** (single sheet) |
| **Rows** | 69,677 total | **69,086** |
| **Hierarchy** | Theme → Dept → Sub_Domain → Topic (4 levels) | Theme → Dept → **Domain** → Sub_Domain → Topic (**5 levels**) |
| **New column** | — | **`Domain`** (35 unique values) |
| **Extra metadata** | — | `L1_Score`, `L1_Confidence`, `SubDomain_Score`, `SubDomain_Confidence`, `Topic_Source`, `Kerberos`, `Dept_Source` |

**Sample classification path:**  
`AI/ML, Supercomputing & Quantum Computing` → `Computer Science & Engineering` → `Machine Learning & Artificial Intelligence` → `Computer Science and Engineering` → `Tagging`

**Important note:** MongoDB has **69,677** papers. This Excel has **69,086** rows (~591 fewer). Papers not in the sheet will keep `Unclassified` labels unless you add an `Admin_Fallback` sheet later.

---

## Proposed graph model (after update)

```
faculty  ──AUTHORED──►  paper
paper    ──BELONGS_TO──►  theme       (Broad_Theme)
paper    ──IN_DOMAIN──►   domain      (Domain)          ← NEW
paper    ──IN_SUBDOMAIN──► subdomain   (Sub_Domain)
paper    ──HAS_TOPIC──►   topic       (Topic)
```

- `IITD_Department` stays as a **paper attribute** (department search + cluster breakdown).
- Score/confidence columns are **optional metadata** on paper nodes (stored, not shown in UI unless requested).

---

## Recommended first step (optional but advised)

- [ ] **0.1** Rename file to a stable name, e.g. `Classified_DataSheet.xlsx`, and point the pipeline at that path (avoids spaces / duplicate “Copy of” names in scripts).

---

## Task list (execution order)

### Phase 1 — Pipeline (Python)

- [ ] **1.1** Update `pipeline/build_kg.py`
  - Set `EXCEL_PAPERS` to the new workbook
  - Read **all sheets** (currently one: `Classified (1)`)
  - Load columns: `Title`, `Broad_Theme`, `IITD_Department`, `Domain`, `Sub_Domain`, `Topic`
  - Add `domain` on paper nodes
  - Add `domain` node type + `IN_DOMAIN` edge
  - Include `domain` in `explore_index.json`

- [ ] **1.2** Update `pipeline/build_atlas.py`
  - Include `domain` in `atlas_papers.json`
  - Use domain for layout jitter (between theme and sub-domain)

- [ ] **1.3** Update `knowledge-graph/README.md` (column list + hierarchy)

### Phase 2 — Backend (Node.js)

- [ ] **2.1** Update `src/controllers/kgController.js`
  - Atlas search: match on `domain`
  - Cluster breakdown query: include `domain` in text match
  - Explore API: support `type=domain` in term list/search

### Phase 3 — Frontend (`tech-ambit-explorer`)

- [ ] **3.1** Update `types.ts` — add `domain` on `KgAtlasPaper`
- [ ] **3.2** Update `atlasClusters.ts`
  - Domain index for search suggestions
  - Search matching + sidebar highlight level for Domain
- [ ] **3.3** Update `ResearchAtlas.tsx`
  - Show domain in tooltips / paper panel tags
  - Add **Domain** highlight toggle (between Theme and Sub-domain)
  - Update search placeholder text

### Phase 4 — Run & verify

- [ ] **4.1** Run `python pipeline/build_kg.py` (requires MongoDB)
- [ ] **4.2** Run `python pipeline/build_atlas.py` (also runs inside `build_kg.py`)
- [ ] **4.3** Restart backend to reload JSON outputs
- [ ] **4.4** Smoke test:
  - Atlas loads papers with `domain` field
  - Search e.g. `Power & Energy Systems`
  - Paper sidebar shows Domain + highlight option
  - Search → click theme → department panel still works

### Phase 5 — Out of scope (unless you ask)

- Re-run `paper_classifier.py`
- Neo4j export changes
- UI for L1/SubDomain confidence scores
- Merging missing ~591 papers from old `Admin_Fallback` sheet

---

## Files expected to change

| File | Change |
|------|--------|
| `pipeline/build_kg.py` | Primary — new Excel + Domain node/edge |
| `pipeline/build_atlas.py` | Atlas JSON includes domain |
| `src/controllers/kgController.js` | Search + explore |
| `tech-ambit-explorer/.../types.ts` | Type |
| `tech-ambit-explorer/.../atlasClusters.ts` | Search/index/highlight |
| `tech-ambit-explorer/.../ResearchAtlas.tsx` | UI |
| `knowledge-graph/README.md` | Docs |

**Regenerated outputs:**
- `data/knowledge-graph/graphs/*.json`
- `data/knowledge-graph/explore_index.json`
- `data/knowledge-graph/atlas_papers.json`

---

## Risks / decisions for you

1. **Single sheet only** — Confirm this is intentional (no Admin_Fallback). ~591 MongoDB papers may stay unclassified.
2. **Filename** — OK to rename to `Classified_DataSheet.xlsx` during implementation?
3. **Department cluster click** — Will remain as-is (search → theme → departments).

---

## Approval

Reply **approve** (optionally: “keep filename as-is” or “rename to Classified_DataSheet.xlsx”) to proceed with implementation and pipeline run.
