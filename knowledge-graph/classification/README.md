# ResearchAmbit — IITD Knowledge Graph Classifier

A fully local, privacy-compliant NLP pipeline that classifies every IIT Delhi research paper into a **4-level hierarchical node path** ready for ingestion into a Neo4j knowledge graph.

---

## Table of Contents

1. [What This Does](#1-what-this-does)
2. [Architecture Overview](#2-architecture-overview)
3. [The 4-Level Hierarchy](#3-the-4-level-hierarchy)
4. [Repository Structure](#4-repository-structure)
5. [Data Sources (MongoDB)](#5-data-sources-mongodb)
6. [Module Deep-Dives](#6-module-deep-dives)
   - [keyword_extractor.py](#61-keyword_extractorpy)
   - [paper_classifier.py](#62-paper_classifierpy)
7. [Parallelisation Strategy](#7-parallelisation-strategy)
8. [Output Format](#8-output-format)
9. [Installation](#9-installation)
10. [Usage](#10-usage)
11. [Configuration Reference](#11-configuration-reference)
12. [Design Decisions & Trade-offs](#12-design-decisions--trade-offs)
13. [Known Limitations](#13-known-limitations)

---

## 1. What This Does

IIT Delhi publishes research papers across 16 academic departments. This pipeline:

1. Reads every paper from a production MongoDB collection (`researchmetadatascopus` — 69,677 papers).
2. Assigns each paper to a **4-level classification hierarchy** representing its position in a Neo4j knowledge graph.
3. Writes results to a two-sheet Excel workbook — one sheet for cleanly classified papers, one for papers whose author maps to an administrative unit and needs manual review.

All computation is **fully local** — no cloud APIs, no data leaves the server. The only network call is to the MongoDB instance on the local network.

---

## 2. Architecture Overview

```
MongoDB (read-only)
  researchmetadatascopus      ← paper title, abstract, kerberos, field_associated
  faculties                   ← email, department (ObjectId ref)
  departments                 ← _id, name
          │
          │  Phase 1: Fetch all docs (one MongoDB round-trip)
          ▼
  Raw Documents (69,677)
          │
          │  Phase 2: Text cleaning + kerberos → dept map
          ▼
  Cleaned Texts + Lookup Table
          │
          │  Phase 3: Batch sentence encoding
          │           model.encode(all_texts, batch_size=256)
          │           → single vectorised forward pass
          ▼
  Paper Embeddings  (N × 384 float32 matrix)
          │
          │  Phase 4: Vectorised cosine classification
          │           Level 1 → (N×9) matrix op  → argmax → theme name
          │           Level 2 → kerberos DB lookup (O(1) dict)
          │                     + (N×16) matrix op for fallback papers only
          │           Level 3 → grouped (m×k) matrix op per department
          ▼
  Levels 1–3 assigned for all N papers
          │
          │  Phase 5: Parallel YAKE extraction
          │           ProcessPoolExecutor(max_workers=all_cores)
          │           Each core runs YAKE on its own chunk independently
          ▼
  Level 4 (Topic) assigned for all N papers
          │
          ▼
  classified_all_69k.xlsx
    ├── Sheet: Classified      (67,525 rows — DB-verified dept)
    └── Sheet: Admin_Fallback  ( 2,152 rows — inferred dept, needs review)
```

**Full corpus benchmark (MacBook, 10 logical cores):**

| Phase | Time | Notes |
|---|---|---|
| MongoDB fetch | 36 s | 69,677 docs, single cursor |
| Text prep + kerberos map | 6 s | 1,041 mappings loaded |
| Batch sentence encoding | ~530 s | 273 batches of 256 |
| Vectorised cosine (Levels 1–3) | ~9 s | Pure numpy BLAS |
| Parallel YAKE (Level 4) | ~61 s | 10 cores, ~7,000 papers/core |
| **Total** | **~654 s (~11 min)** | **106 papers/sec** |

---

## 3. The 4-Level Hierarchy

Each paper is assigned a path through the knowledge graph:

```
Broad Theme  →  IITD Department  →  Sub-Domain  →  Topic
   (L1)              (L2)              (L3)          (L4)
```

### Level 1 — Broad Thematic Area

One of **9 strategic themes** aligned with national research priorities (DST / IITD):

| # | Theme |
|---|---|
| 1 | AI/ML, Supercomputing & Quantum Computing |
| 2 | Healthcare & MedTech |
| 3 | Manufacturing & Industry 4.0 |
| 4 | Smart & Sustainable Infrastructure |
| 5 | Advanced Materials & Devices |
| 6 | Energy, Sustainability & Climate Change |
| 7 | Quantum Technologies & Semiconductor Technology |
| 8 | Next-Gen Communication |
| 9 | Social Sciences, Humanities & Management |

**How assigned:** Cosine similarity between the paper embedding and rich multi-keyword theme descriptions (not just the short display names). For example, the theme "AI/ML, Supercomputing & Quantum Computing" is embedded as:
> *"artificial intelligence machine learning deep learning neural networks high performance computing supercomputing quantum computing algorithms data science natural language processing computer vision"*

This gives the model much more surface area to match against than the 6-word display name alone.

### Level 2 — IITD Department

One of **16 canonical IIT Delhi academic departments**:

> Applied Mechanics · Biochemical Engineering and Biotechnology · Chemical Engineering · Chemistry · Civil and Environmental Engineering · Computer Science and Engineering · Design · Electrical Engineering · Energy Science and Engineering · Humanities and Social Sciences · Management Studies · Materials Science and Engineering · Mathematics · Mechanical Engineering · Physics · Textile and Fibre Engineering

**How assigned — strict DB lookup first, semantic fallback:**

```
paper.kerberos  (e.g. "rsingh")
    → faculties collection: find document where email starts with "rsingh@"
    → faculties.department  (MongoDB ObjectId)
    → departments collection: look up departments._id
    → departments.name  (e.g. "Computer Science & Engineering")
    → map to canonical display name  (e.g. "Computer Science and Engineering")
```

If the kerberos is not found in the database, or if it maps to an administrative unit (e.g. "Central Library", "IIT Delhi Hospital"), the pipeline falls back to cosine similarity against the 16 department names, with a small `+0.05×` boost from the Scopus `field_associated` value as a soft prior.

The `Dept_Source` column records how each assignment was made:

| Value | Meaning |
|---|---|
| `DB` | Kerberos → faculty → academic department (ground truth) |
| `Semantic` | Kerberos not found in DB; cosine similarity used |
| `Admin-Fallback` | Kerberos found but maps to an admin unit; cosine similarity used |

### Level 3 — Sub-Domain

A curated academic sub-domain within the assigned department. There are **8–13 sub-domain labels per department** (155 total), hand-selected to represent the realistic research surface of each department.

**How assigned:** Cosine similarity between the paper embedding and the sub-domain label list for Level 2's department. Because papers are grouped by department before computing similarity, this is a single batch matrix operation per department rather than 69,677 individual cosine calls.

Example sub-domains for **Computer Science and Engineering**:
> Machine Learning and AI · Computer Vision · Natural Language Processing · Algorithms and Complexity · Computer Networks · Software Engineering · Cybersecurity · Databases and Information Systems · Human-Computer Interaction · Distributed and Cloud Computing · Internet of Things · Computer Architecture · Robotics

### Level 4 — Topic (YAKE leaf node)

A specific technical keyphrase extracted from the paper's title and abstract using YAKE (Yet Another Keyword Extractor). This is the most granular level — the actual leaf node name in the knowledge graph.

**Example full path:**
```
AI/ML, Supercomputing & Quantum Computing
  → Computer Science and Engineering
    → Computer Vision
      → "Convolutional Neural Network"
```

---

## 4. Repository Structure

```
ResearchAmbit/
├── keyword_extractor.py      # YAKE-based keyphrase extraction (Level 4)
├── paper_classifier.py       # 4-level classification pipeline (Levels 1–4)
├── taxonomy_builder.py       # (Legacy) NMF topic modelling experiment — not used in production
├── classified_all_69k.xlsx   # Output: full corpus classification results
│     ├── Sheet: Classified       (67,525 papers — DB-verified)
│     └── Sheet: Admin_Fallback   ( 2,152 papers — inferred dept)
└── README.md                 # This file
```

---

## 5. Data Sources (MongoDB)

**Connection:** `mongodb://admin:password@10.17.8.24/admin`  
**Database:** `research_ambit`

> **IMPORTANT:** The pipeline is **strictly read-only**. No writes are performed on the production database at any point.

### Collections used

#### `researchmetadatascopus`
Primary paper metadata imported from Scopus.

| Field | Type | Used for |
|---|---|---|
| `title` | String | Text for YAKE + embedding |
| `abstract` | String | Text for YAKE + embedding |
| `kerberos` | String | Author ID for dept DB lookup |
| `field_associated` | String | Scopus domain code — soft prior for dept fallback |

#### `faculties`
IITD faculty directory.

| Field | Type | Used for |
|---|---|---|
| `email` | String | `email.split('@')[0]` → kerberos key |
| `department` | ObjectId | Reference to `departments._id` |

#### `departments`
IITD department registry.

| Field | Type | Used for |
|---|---|---|
| `_id` | ObjectId | Join key from `faculties.department` |
| `name` | String | Raw department name (mapped to canonical display name) |

---

## 6. Module Deep-Dives

### 6.1 `keyword_extractor.py`

Standalone YAKE-based keyword extraction module. Provides the building blocks for Level 4 and is also usable independently.

#### `clean_raw_text(text: str) -> str`

Removes structural noise from raw Scopus strings while **preserving original casing**.

> **Why casing must be preserved:** YAKE's statistical model uses uppercase letters and acronyms as strong importance signals. "CO2" scores very differently from "co2" — lowercasing before YAKE destroys the very features it depends on.

Noise patterns removed (in order):
1. HTML entity unescaping (`&amp;` → `&`, `&#169;` → `©`)
2. HTML/XML tag removal (`<sup>text</sup>` → `text`)
3. Web URL removal (`http://...`, `www....`)
4. Copyright trailer strip (everything from `©` or `"Copyright"` onward — Scopus abstracts end with publisher notices)
5. Smart/escaped quote normalization (`"semantic gap"` → `'semantic gap'`)
6. Whitespace normalization (tabs, newlines, double spaces → single space)

#### `is_placeholder_abstract(text: str) -> bool`

Guards against the Scopus importer writing `"(No abstract available)"` into the abstract field. Without this check, YAKE would extract `"No Abstract Available"` as the top keyword for ~15% of papers.

#### `_compute_dynamic_ngram(word_count: int) -> int`

Dynamically sizes YAKE's n-gram window based on available text length:

| Text length | n-gram | Rationale |
|---|---|---|
| < 25 words | `n=1` | Title-only: no statistical differentiation for multi-word phrases |
| 25–70 words | `n=2` | Short abstract: 2-word technical phrases are meaningful |
| > 70 words | `n=3` | Full abstract: rich 3-word composite terms possible |

**Why this matters:** With a fixed `n=3` on a 10-word title, YAKE generates every overlapping 3-word window as a candidate. On `"bio-inspired gyroid cellular architectured metabeam"` it produces `"bio-inspired gyroid cellular"`, `"gyroid cellular architectured"`, and `"cellular architectured metabeam"` — all statistically identical on short text, leading to three near-duplicate keywords.

#### `_build_extractor(n, candidate_pool) -> yake.KeywordExtractor`

Configures YAKE with parameters tuned for academic text:

| Parameter | Value | Reason |
|---|---|---|
| `lan` | `"en"` | English stopword list and tokenizer |
| `n` | dynamic | Sized to available text (see above) |
| `dedupLim` | `0.75` | Stricter deduplication inside YAKE (lower = stricter) |
| `dedupFunc` | `"seqm"` | SequenceMatcher — more accurate than Levenshtein for technical phrases |
| `windowsSize` | `1` | Immediate-neighbor co-occurrence — appropriate for dense academic sentences |
| `top` | `top_n × 3` | Over-fetch candidates so post-filter has a larger pool to pick from |

#### `_remove_overlapping_phrases(phrases: list[str]) -> list[str]`

Post-YAKE deduplication using two complementary checks:

1. **Jaccard similarity** — if two phrases share ≥60% of their word tokens, the lower-ranked one is dropped.
2. **Subset/superset check** — if one phrase's word set is entirely contained within another's (e.g., `{"Pro"}` ⊂ `{"Chemkin", "Pro"}`), the subset is dropped.

#### `extract_academic_keywords(title, abstract, top_n=3) -> list[str]`

Main extraction function. Returns a list of `top_n` clean Title Case keyphrases. Pads with `"Research Topic"` if YAKE cannot find enough distinct results.

---

### 6.2 `paper_classifier.py`

The central orchestration module. Handles all 4 classification levels and the full parallelised batch pipeline.

#### Embedding model

**`all-MiniLM-L6-v2`** (sentence-transformers) — a lightweight but high-quality sentence embedding model:
- 22M parameters, runs on CPU without GPU
- 384-dimensional embeddings
- Trained for semantic textual similarity — ideal for matching paper text to curated label lists
- Downloads once, cached to `~/.cache/torch/sentence_transformers/`

All embeddings are **lazily computed and cached in module-level globals** so they are computed at most once per process, even when `classify_paper` is called thousands of times:

```python
_model            # SentenceTransformer instance
_theme_embeddings # (9,  384) — broad theme descriptions
_dept_embeddings  # (16, 384) — IITD department names (fallback only)
_sublabel_cache   # {dept_key: (n_sub, 384)} — per-department sub-domains
_kerberos_dept_map # {kerberos_str: dept_name_str} — DB lookup table
```

#### `_load_kerberos_dept_map()`

Builds a `kerberos → department name` dict from MongoDB in a single startup pass:

```
departments._id → departments.name    (all departments, ~50 docs)
faculties.email → faculties.department  (all faculty, ~1,041 docs)
email.split('@')[0].lower() = kerberos key
```

Cached after first call. The entire lookup table for 69,677 papers is built from just ~1,100 MongoDB documents.

#### `_compute_subdomains_batch(paper_embs, dept_names)`

Vectorised sub-domain assignment for N papers using grouped matrix operations:

1. Group all paper indices by their department's sublabel key (at most 16 groups).
2. For each group, slice the paper embedding matrix and run **one** `cosine_similarity(group_embs, label_embs)` call — a single (m × k) matrix multiply.
3. `argmax` over columns gives the best sub-domain label index for each paper in the group.

This replaces 69,677 individual cosine calls with at most 16 group-level matrix operations.

#### `_yake_worker(args) -> (start_idx, topics)`

Module-level function (required to be picklable by `multiprocessing`). Each worker process:
1. Imports `keyword_extractor` independently (each process gets its own YAKE state).
2. Runs `extract_academic_keywords` on its assigned chunk.
3. Returns `(start_index, [topic, ...])` so the parent can reassemble results in order.

#### `classify_paper(title, abstract, kerberos, field_associated) -> dict`

Single-paper classification API (used when classifying one paper at a time, e.g., in real-time ingestion). Returns:

```python
{
    "broad_theme":     "AI/ML, Supercomputing & Quantum Computing",
    "iitd_department": "Computer Science and Engineering",
    "dept_source":     "DB",           # "DB" | "Semantic" | "Admin-Fallback"
    "sub_domain":      "Computer Vision",
    "topic":           "Convolutional Neural Network",
}
```

#### `run_batch_classification(...)`

Full parallelised batch runner. Implements the 5-phase architecture described in §2.

---

## 7. Parallelisation Strategy

The original per-paper loop called `model.encode([one_paper])` 69,677 times and ran YAKE serially. Three changes bring this to 106 papers/sec:

### 7.1 Batch Sentence Encoding

```python
paper_embs = model.encode(
    all_paper_texts,
    batch_size=256,
    show_progress_bar=True,
    convert_to_numpy=True,
)
```

`sentence-transformers` handles internal batching and uses every available CPU thread via PyTorch. One vectorised forward pass replaces 69,677 individual inference calls. The speedup on a 10-core machine is approximately **40×** for this phase.

### 7.2 Vectorised Cosine Similarity

```python
# Level 1: one (N×9) matrix multiply for all papers
theme_sims = cosine_similarity(paper_embs, theme_embs)   # (69677, 9)

# Level 3: at most 16 group-level matrix multiplies
for dept_key, paper_indices in dept_groups.items():
    sims = cosine_similarity(paper_embs[indices], label_embs)  # (m, k)
```

numpy's `cosine_similarity` uses BLAS under the hood. These operations complete in seconds regardless of N.

### 7.3 Parallel YAKE (ProcessPoolExecutor)

```python
chunk_size = ceil(n / os.cpu_count())          # ~7,000 papers per core
chunks = [(start, pairs[start:start+chunk_size]) for start in range(0, n, chunk_size)]

with ProcessPoolExecutor(max_workers=os.cpu_count()) as executor:
    for start_idx, topics in executor.map(_yake_worker, chunks):
        reassemble(start_idx, topics)
```

YAKE is pure Python and CPU-bound. Distributing it across all logical cores (performance + efficiency) on Apple Silicon saturates every core independently. Results are reassembled in order using the preserved `start_index`.

**Why `ProcessPoolExecutor` (not `ThreadPoolExecutor`):** Python's GIL prevents true CPU parallelism with threads. Processes have separate memory spaces and GILs, so all cores run YAKE simultaneously.

---

## 8. Output Format

### `classified_all_69k.xlsx`

#### Sheet: `Classified` (67,525 rows)

Papers whose author kerberos maps to a known academic department in MongoDB. Department assignment is ground-truth, not inferred. Ready for Neo4j ingestion.

| Column | Example value |
|---|---|
| `Title` | Tagboards for video tagging |
| `Kerberos` | pkalra |
| `Broad_Theme` | AI/ML, Supercomputing & Quantum Computing |
| `IITD_Department` | Computer Science and Engineering |
| `Dept_Source` | DB |
| `Sub_Domain` | Natural Language Processing |
| `Topic` | Tagging |

#### Sheet: `Admin_Fallback` (2,152 rows)

Papers whose kerberos maps to an administrative or non-academic unit (e.g. Dean's Office, Central Library, IIT Delhi Hospital). The department in these rows was inferred by semantic similarity — it is a best-guess, not ground-truth. **Manual review recommended before Neo4j ingestion.**

Same columns as `Classified`, but `Dept_Source` will be `Admin-Fallback`.

---

## 9. Installation

```bash
pip install yake sentence-transformers scikit-learn pymongo pandas openpyxl
```

All packages run entirely locally on CPU — no GPU required, no cloud API keys needed.

**Python version:** 3.10+ (uses `X | Y` union type hints and `match` syntax in places)

---

## 10. Usage

### Classify the full corpus (all papers)

```bash
python paper_classifier.py --limit 0 --output classified_all_69k.xlsx
```

### Classify a subset (for testing)

```bash
python paper_classifier.py --limit 500 --output test_500.xlsx
```

### All options

```
--limit INT        Number of papers to classify. 0 = all (default: 0).
--output PATH      Output Excel file (default: classified_papers.xlsx).
--workers INT      Number of YAKE CPU workers (default: all logical cores).
--batch-size INT   Sentence-transformer batch size (default: 256).
```

### Use the classifier in your own code

```python
from paper_classifier import classify_paper

result = classify_paper(
    title="Optimization of CO2 Storage using Chemkin Pro",
    abstract="This study explores carbon dioxide reaction dynamics...",
    kerberos="rsingh",           # from paper document
    field_associated="ENGI",     # Scopus field code (optional)
)

print(result)
# {
#   'broad_theme':     'Energy, Sustainability & Climate Change',
#   'iitd_department': 'Chemical Engineering',
#   'dept_source':     'DB',
#   'sub_domain':      'Carbon Capture and Storage',
#   'topic':           'Chemkin Pro Simulation',
# }
```

### Extract keywords only (YAKE standalone)

```python
from keyword_extractor import extract_academic_keywords

keywords = extract_academic_keywords(
    title="Optimization of CO2 Storage and Conversion using Chemkin Pro",
    abstract="This study explores the reaction dynamics of carbon dioxide...",
    top_n=3,
)
# ['Chemkin Pro Simulation', 'Carbon Dioxide Storage', 'Transition Metals']
```

---

## 11. Configuration Reference

### Broad Themes (`paper_classifier.py → _BROAD_THEMES_RAW`)

Each theme is a `(display_name, embedding_description)` tuple. To add or rename a theme:
1. Add/edit the tuple in `_BROAD_THEMES_RAW`.
2. Clear the `_theme_embeddings` cache (set to `None`) or restart the process — it will recompute automatically.

### IITD Departments (`paper_classifier.py → IITD_DEPARTMENTS`)

Flat list of 16 department display names. These are the canonical values written to the Excel output and Neo4j. The `_DB_NAME_TO_SUBLABEL_KEY` dict handles the mismatch between raw MongoDB department names and these canonical names.

### Sub-Domain Vocabulary (`paper_classifier.py → DEPARTMENT_SUBLABELS`)

Dictionary keyed by canonical department name. To add sub-domain labels for a department:
```python
DEPARTMENT_SUBLABELS["Chemical Engineering"].append("Green Chemistry Processes")
```
Clear `_sublabel_cache` to recompute embeddings.

### MongoDB connection (`paper_classifier.py → MONGO_URI / DB_NAME / COLLECTION`)

```python
MONGO_URI  = "mongodb://admin:password@10.17.8.24/admin"
DB_NAME    = "research_ambit"
COLLECTION = "researchmetadatascopus"
```

### Admin department names (`paper_classifier.py → _ADMIN_DEPT_NAMES`)

A `frozenset` of raw DB department names treated as non-academic. Papers from these departments fall through to semantic similarity for Level 2. Add new admin unit names here as the org chart evolves.

---

## 12. Design Decisions & Trade-offs

### Why YAKE for Level 4 instead of an LLM?

YAKE runs in ~1 ms per paper, fully offline, with no API cost. An LLM call would be 100–1000× slower and would require network access. YAKE's statistical approach also has a useful property for knowledge graphs: it extracts phrases that are **statistically unusual in the document** (not just frequent), which maps well to distinctive technical terminology.

### Why curated sub-domain labels instead of automated topic modelling (NMF/LDA)?

NMF topic modelling was tried first (see `taxonomy_builder.py`). The labels it produced were noisy: boilerplate fragments like `"Preface Introduction"`, `"Table Contents"`, and generic verbs appeared at the top of many topics. Manually curated labels from known academic curricula are semantically precise and guaranteed to be meaningful knowledge graph node names.

### Why `all-MiniLM-L6-v2` instead of a larger model?

It is the standard lightweight sentence-similarity model from the sentence-transformers library — fast on CPU, 384-dim embeddings, trained specifically for semantic similarity tasks. Larger models (e.g., `all-mpnet-base-v2`) offer marginal accuracy gains on coarse classification tasks like this, but are 4–5× slower to encode. Since Level 2 is dominated by ground-truth DB lookups (96.9% of papers), the model only has to be good on the ~3% fallback cases.

### Why ProcessPoolExecutor for YAKE instead of asyncio or threads?

YAKE is a pure-Python CPU-bound workload. Python's GIL prevents true parallelism with threads for CPU-bound code. `ProcessPoolExecutor` spawns separate interpreter processes, each with their own GIL, achieving genuine parallel execution on all CPU cores.

### Why batch-encode all papers before classifying, rather than encode-and-classify per paper?

Calling `model.encode([single_text])` 69,677 times incurs Python function call overhead, CUDA/MKL context switching, and cannot exploit data-level parallelism inside the model. A single `model.encode(all_texts, batch_size=256)` call lets PyTorch pack 256 papers into one forward pass at a time, achieving near-peak hardware utilisation.

---

## 13. Known Limitations

| Issue | Impact | Mitigation |
|---|---|---|
| 2,152 papers (3.1%) have kerberos → admin department | Level 2 dept is inferred, not ground-truth | Separated into `Admin_Fallback` sheet for manual review |
| Papers with no abstract (`"(No abstract available)"`) | YAKE only has the title to work with; topic may be generic | `is_placeholder_abstract()` prevents YAKE from extracting the placeholder string itself |
| Very short titles (< 25 words, no abstract) | YAKE forced to `n=1`; topic is a single word | Single-word topics still useful as leaf nodes; sub_domain (Level 3) provides context |
| `all-MiniLM-L6-v2` is a general-purpose model | May misclassify highly interdisciplinary papers at Level 1 | Level 2 (DB lookup) is always correct when kerberos is found; Level 1 is a coarse grouping |
| Kerberos field may be missing for some papers | Paper falls back to semantic dept matching | `Dept_Source = "Semantic"` flags these for audit |
| Sub-domain labels are English-language only | Hindi or transliterated titles may embed poorly | Majority of IITD Scopus papers are in English |
