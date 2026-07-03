# Knowledge Graph — Update for `Copy of Classified_DataSheet.xlsx`

**Requested by:** User  
**New source file:** `classification/Copy of Classified_DataSheet.xlsx`  
**Status:** ⏳ Awaiting approval — **do not run scripts until approved**

---

## Context (what I found in the repo)

| Item | Current state |
|------|----------------|
| **Pipeline Excel path** | `Copy of Copy of Classified_DataSheet.xlsx` (in `build_kg.py`) |
| **Your new file** | `Copy of Classified_DataSheet.xlsx` (newer, ~7.7 MB, added 03-Jul-2026) |
| **Old file** | `classified_all_69k.xlsx` (4-level: no Domain column) |
| **Domain in code** | Already implemented in `build_kg.py`, `build_atlas.py`, `kgController.js`, and frontend atlas |
| **Current hierarchy in code** | Theme → **Domain** → Sub_Domain → Topic (5 levels) |

**Important:** Most **code changes for Domain are already done** from the earlier migration. This task is mainly to **point the pipeline at your new Excel file**, validate it, **rebuild JSON outputs**, and verify end-to-end.

---

## Phase 0 — Validate new Excel (read-only, before any writes)

- [ ] **0.1** Open `Copy of Classified_DataSheet.xlsx` and record:
  - Sheet name(s)
  - Row count
  - Column names
- [ ] **0.2** Confirm required columns exist:
  - `Title`
  - `Broad_Theme`
  - `IITD_Department`
  - **`Domain`** ← new level you added
  - `Sub_Domain`
  - `Topic`
- [ ] **0.3** Compare vs current pipeline file (`Copy of Copy of Classified_DataSheet.xlsx`):
  - Row count difference
  - Domain count / unique values
  - Any missing or renamed columns
- [ ] **0.4** Report summary back to you before rebuild (counts only, no code change yet)

---

## Phase 1 — Pipeline config (Python)

- [ ] **1.1** Update `pipeline/build_kg.py`
  - Change `EXCEL_PAPERS` to:
    ```text
    classification/Copy of Classified_DataSheet.xlsx
    ```
  - Keep reading **all sheets** (same as now)
  - Keep loading: `Title`, `Broad_Theme`, `IITD_Department`, `Domain`, `Sub_Domain`, `Topic`
- [ ] **1.2** Confirm graph model (already in code — verify after rebuild):
  ```
  paper → BELONGS_TO  → theme
  paper → IN_DOMAIN   → domain      ← Domain node
  paper → IN_SUBDOMAIN → subdomain
  paper → HAS_TOPIC   → topic
  ```
- [ ] **1.3** Confirm `pipeline/build_atlas.py`
  - Still includes `domain` in `atlas_papers.json`
  - Still excludes unclassified / missing-domain papers when `classified_only=True`
- [ ] **1.4** Update `knowledge-graph/README.md`
  - Document new Excel filename and 5-level hierarchy

**Optional (only if you approve):**

- [ ] **1.5** Rename file to a stable name, e.g. `Classified_DataSheet.xlsx`, and update `EXCEL_PAPERS` (avoids “Copy of” in scripts)

---

## Phase 2 — Backend (Node.js)

- [ ] **2.1** Review `src/controllers/kgController.js` — domain search/explore already present; re-check after rebuild
- [ ] **2.2** Ensure atlas API serves fresh JSON with `domain` field and no stale cache

**Expected:** No backend code changes unless validation finds a column rename or missing field.

---

## Phase 3 — Frontend (`tech-ambit-explorer`)

- [ ] **3.1** Confirm atlas types and UI already support `domain` (paper panel, search, theme → domain clusters)
- [ ] **3.2** After rebuild, smoke-test Research Atlas with new data

**Expected:** No frontend code changes unless counts/labels look wrong after rebuild.

---

## Phase 4 — Run pipeline & verify (after your approval)

- [ ] **4.1** Run from `research-ambit-main/knowledge-graph/pipeline`:
  ```powershell
  python -u build_kg.py
  ```
  - Requires MongoDB (`MONGO_URI` in `.env`)
  - Regenerates per-faculty graphs + `explore_index.json`
  - Runs `build_atlas.py` at end (or run separately)
- [ ] **4.2** Run (if not invoked by build_kg):
  ```powershell
  python -u build_atlas.py
  ```
- [ ] **4.3** Restart backend server so it loads new JSON
- [ ] **4.4** Verification checklist:
  | Check | Expected |
  |-------|----------|
  | `explore_index.json` | Contains `domain` terms |
  | `atlas_papers.json` | Papers have `domain` field; classified-only count matches Excel scope |
  | Atlas UI | ~9 themes, domain clusters on theme click, correct paper counts |
  | Search | e.g. a Domain name returns matching papers |
  | API | `/api/kg/explore/terms?q=...` includes domain results |

---

## Files likely to change

| File | Action |
|------|--------|
| `pipeline/build_kg.py` | Update Excel path (+ docstring) |
| `knowledge-graph/README.md` | Update source filename / hierarchy |
| `TASKS-new-classified-datasheet.md` | Mark tasks complete after run |

**Regenerated (not hand-edited):**

| Output | Path |
|--------|------|
| Faculty graphs | `data/knowledge-graph/graphs/*.json` |
| Explore index | `data/knowledge-graph/explore_index.json` |
| Atlas | `data/knowledge-graph/atlas_papers.json` |
| Faculty indices | `data/knowledge-graph/atlas_faculty_indices.json` |

---

## Out of scope (unless you ask)

- Re-running `paper_classifier.py`
- Neo4j export changes
- Merging papers from old `Admin_Fallback` sheet
- UI for L1/SubDomain confidence score columns (if present in Excel)

---

## Decisions needed from you

1. **Filename** — Use `Copy of Classified_DataSheet.xlsx` as-is, or rename to `Classified_DataSheet.xlsx`?
2. **Sheets** — Should the pipeline read **all sheets** in the workbook, or only one named sheet (e.g. `Classified`)?
3. **Unclassified papers** — OK if MongoDB papers not in Excel stay `Unclassified` and are excluded from atlas?

---

## Approval

Reply with **approve** and your choices:

- **A)** Keep filename: `Copy of Classified_DataSheet.xlsx`  
- **B)** Rename to: `Classified_DataSheet.xlsx`  
- **Sheets:** all / single sheet name: _______

After approval, I will run Phase 0 → Phase 4 in order and report counts + verification results.
