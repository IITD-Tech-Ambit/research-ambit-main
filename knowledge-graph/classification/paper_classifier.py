# ==============================================================================
# paper_classifier.py
#
# 4-level knowledge graph classifier for IIT Delhi research papers.
#
#   Level 1 — Broad Theme      : one of 9 strategic thematic areas
#                                (semantic match via sentence-transformers)
#   Level 2 — IITD Department  : STRICT DB LOOKUP via kerberos
#                                paper.kerberos → faculties.email prefix
#                                → faculties.department (OID) → departments.name
#                                Falls back to semantic match only when the
#                                kerberos is not found in the database.
#   Level 3 — Sub-Domain       : curated sub-domain within the department
#                                (semantic match via sentence-transformers)
#   Level 4 — Topic            : YAKE-extracted keyphrase (leaf node)
#
# LOCAL INSTALLATION (one-time setup):
#   pip install sentence-transformers scikit-learn pymongo pandas openpyxl yake
#
# USAGE:
#   python paper_classifier.py               # classifies top 100 papers
#   python paper_classifier.py --limit 500   # classifies 500 papers
# ==============================================================================

from __future__ import annotations

import numpy as np
from sklearn.metrics.pairwise import cosine_similarity

from keyword_extractor import (
    clean_raw_text,
    extract_academic_keywords,
    is_placeholder_abstract,
)


# ==============================================================================
# Level 1 — Broad Thematic Areas
# ==============================================================================
# 8 strategic research themes aligned with national priorities (DST / IITD).
# Each entry is a (display_name, embedding_description) tuple.
# The display_name is used as the KG node label; the embedding_description
# is a richer phrase used for cosine similarity so the model captures the
# full scope of the theme, not just the abbreviated title.

_BROAD_THEMES_RAW: list[tuple[str, str]] = [
    (
        "AI/ML, Supercomputing & Quantum Computing",
        "artificial intelligence machine learning deep learning neural networks "
        "high performance computing supercomputing quantum computing algorithms "
        "data science natural language processing computer vision",
    ),
    (
        "Healthcare & MedTech",
        "healthcare medical devices biomedical imaging drug discovery genomics "
        "precision medicine telemedicine surgical robotics diagnostics "
        "clinical trials wearable health monitoring bioinformatics",
    ),
    (
        "Manufacturing & Industry 4.0",
        "smart manufacturing additive manufacturing 3D printing industrial IoT "
        "digital twins robotics automation CNC machining predictive maintenance "
        "supply chain intelligent factory lean production",
    ),
    (
        "Smart & Sustainable Infrastructure",
        "smart cities green buildings sustainable construction transportation "
        "water management waste management urban planning structural health "
        "monitoring climate resilient infrastructure civil engineering",
    ),
    (
        "Advanced Materials & Devices",
        "nanomaterials 2D materials graphene metamaterials semiconductors "
        "smart materials biomaterials energy materials photonic devices "
        "thin films composites functional materials characterisation",
    ),
    (
        "Energy, Sustainability & Climate Change",
        "solar energy wind energy energy storage batteries carbon capture "
        "climate change sustainability renewable energy bioenergy hydrogen "
        "fuel cells circular economy environmental science ecology",
    ),
    (
        "Quantum Technologies & Semiconductor Technology",
        "quantum communication quantum sensing quantum cryptography "
        "semiconductor fabrication photonics VLSI microelectronics "
        "quantum materials quantum dots spintronics chip design",
    ),
    (
        "Next-Gen Communication",
        "5G 6G wireless communication internet of things satellite "
        "optical communication network security edge computing "
        "software defined networking antenna signal processing millimeter wave",
    ),
    (
        "Social Sciences, Humanities & Management",
        "economics finance management social sciences humanities history "
        "linguistics philosophy policy governance agriculture rural development "
        "behavioral economics sociology anthropology psychology education "
        "public policy international trade development studies",
    ),
]

# Separate display names and embedding descriptions into parallel lists
BROAD_THEME_NAMES: list[str] = [t[0] for t in _BROAD_THEMES_RAW]
_BROAD_THEME_DESCRIPTIONS: list[str] = [t[1] for t in _BROAD_THEMES_RAW]


# ==============================================================================
# Level 2 — IITD Departments
# ==============================================================================

IITD_DEPARTMENTS: list[str] = [
    "Applied Mechanics",
    "Biochemical Engineering and Biotechnology",
    "Chemical Engineering",
    "Chemistry",
    "Civil and Environmental Engineering",
    "Computer Science and Engineering",
    "Design",
    "Electrical Engineering",
    "Energy Science and Engineering",
    "Humanities and Social Sciences",
    "Management Studies",
    "Materials Science and Engineering",
    "Mathematics",
    "Mechanical Engineering",
    "Physics",
    "Textile and Fibre Engineering",
]


# ==============================================================================
# Level 3 — Sub-Domain Vocabulary (per IITD department)
# ==============================================================================

DEPARTMENT_SUBLABELS: dict[str, list[str]] = {
    "Applied Mechanics": [
        "Solid Mechanics",
        "Fluid Mechanics",
        "Structural Dynamics",
        "Biomechanics",
        "Computational Mechanics",
        "Fracture and Fatigue",
        "Vibration and Acoustics",
        "Tribology and Wear",
        "Geomechanics",
        "Impact and Wave Propagation",
    ],
    "Biochemical Engineering and Biotechnology": [
        "Bioprocess Engineering",
        "Metabolic Engineering",
        "Drug Delivery Systems",
        "Bioreactor Design",
        "Protein Engineering",
        "Biosensors",
        "Fermentation Technology",
        "Cell Culture and Tissue Engineering",
        "Enzyme Engineering",
        "Bioinformatics",
    ],
    "Chemical Engineering": [
        "Catalysis and Reaction Engineering",
        "Separation Processes",
        "Process Control and Optimization",
        "Petroleum and Gas Engineering",
        "Polymer Engineering",
        "Transport Phenomena",
        "Computational Fluid Dynamics",
        "Electrochemical Engineering",
        "Nanotechnology",
        "Environmental Process Engineering",
    ],
    "Chemistry": [
        "Organic Chemistry",
        "Inorganic Chemistry",
        "Physical Chemistry",
        "Analytical Chemistry",
        "Polymer Chemistry",
        "Computational Chemistry",
        "Electrochemistry",
        "Catalysis",
        "Spectroscopy and Characterization",
        "Supramolecular Chemistry",
        "Green Chemistry",
    ],
    "Civil and Environmental Engineering": [
        "Structural Engineering",
        "Geotechnical Engineering",
        "Transportation Engineering",
        "Environmental Engineering",
        "Water Resources and Hydraulics",
        "Earthquake Engineering",
        "Construction Management",
        "Remote Sensing and GIS",
        "Urban Infrastructure",
        "Pavement Engineering",
    ],
    "Computer Science and Engineering": [
        "Machine Learning and AI",
        "Computer Vision",
        "Natural Language Processing",
        "Algorithms and Complexity",
        "Computer Networks",
        "Software Engineering",
        "Cybersecurity",
        "Databases and Information Systems",
        "Human-Computer Interaction",
        "Distributed and Cloud Computing",
        "Internet of Things",
        "Computer Architecture",
        "Robotics",
    ],
    "Design": [
        "Product Design",
        "Interaction and UX Design",
        "Visual Communication",
        "Design Thinking and Innovation",
        "Sustainable Design",
        "Ergonomics and Human Factors",
        "Industrial Design",
        "Design for Manufacturing",
    ],
    "Electrical Engineering": [
        "Power Systems and Smart Grid",
        "Control Systems",
        "Signal and Image Processing",
        "VLSI and Microelectronics",
        "Telecommunications",
        "Photonics and Optoelectronics",
        "Robotics and Automation",
        "Embedded Systems",
        "Antennas and RF Engineering",
        "Power Electronics",
    ],
    "Energy Science and Engineering": [
        "Solar Energy",
        "Wind Energy",
        "Energy Storage and Batteries",
        "Fuel Cells and Hydrogen Energy",
        "Smart Grid and Energy Systems",
        "Nuclear Energy",
        "Bioenergy and Biomass",
        "Carbon Capture and Storage",
        "Thermodynamics and Heat Transfer",
        "Energy Policy and Economics",
    ],
    "Humanities and Social Sciences": [
        "Economics and Development",
        "Linguistics and Language",
        "Philosophy and Ethics",
        "History and Culture",
        "Cognitive and Social Psychology",
        "Sociology and Anthropology",
        "Political Science and Policy",
        "Literature and Media Studies",
    ],
    "Management Studies": [
        "Finance and Investment",
        "Marketing",
        "Operations Management",
        "Supply Chain and Logistics",
        "Entrepreneurship and Innovation",
        "Strategic Management",
        "Human Resource Management",
        "Information Systems Management",
        "Corporate Governance",
        "Behavioral Economics",
    ],
    "Materials Science and Engineering": [
        "Nanomaterials",
        "Composite Materials",
        "Semiconductors",
        "Polymers",
        "Thin Films and Coatings",
        "Biomaterials",
        "Metal Alloys and Metallurgy",
        "Ceramics and Glass",
        "Optical and Photonic Materials",
        "Magnetic Materials",
        "Electronic and Energy Materials",
        "Structural Materials",
    ],
    "Mathematics": [
        "Applied Mathematics",
        "Pure Mathematics",
        "Statistics and Probability",
        "Numerical Analysis",
        "Mathematical Physics",
        "Optimization",
        "Differential Equations",
        "Graph Theory and Combinatorics",
        "Topology and Geometry",
        "Mathematical Biology",
    ],
    "Mechanical Engineering": [
        "Thermal Engineering and Heat Transfer",
        "Manufacturing and Production",
        "Machine Design",
        "Fluid Mechanics and Aerodynamics",
        "Robotics and Mechatronics",
        "Automotive Engineering",
        "MEMS and Microsystems",
        "Turbomachinery",
        "Welding and Joining",
        "Industrial Engineering",
    ],
    "Physics": [
        "Condensed Matter Physics",
        "Quantum Physics and Quantum Computing",
        "Optics and Photonics",
        "Astrophysics and Cosmology",
        "Plasma Physics",
        "Nuclear Physics",
        "Particle Physics",
        "Electromagnetism",
        "Nonlinear Dynamics and Chaos",
        "Acoustic Physics",
        "Biophysics",
    ],
    "Textile and Fibre Engineering": [
        "Fibre Science",
        "Yarn Technology",
        "Fabric Engineering",
        "Technical Textiles",
        "Textile Processing and Finishing",
        "Smart and Functional Textiles",
        "Textile Composites",
        "Protective Textiles",
    ],
}


# ==============================================================================
# Constants
# ==============================================================================

MODEL_NAME: str = "all-MiniLM-L6-v2"
_MIN_SIMILARITY: float = 0.05   # Minimum cosine sim to accept any match

MONGO_URI: str = "mongodb://admin:password@10.17.8.24/admin"
DB_NAME: str = "research_ambit"
COLLECTION: str = "researchmetadatascopus"


# ==============================================================================
# DB Department name → DEPARTMENT_SUBLABELS key mapping
# ==============================================================================
# The `departments` collection uses its own naming convention.
# This dict maps every DB department name to the matching key in
# DEPARTMENT_SUBLABELS so Level 3 sub-domain lookup works correctly.
# Academic departments → their exact sub-label key.
# Centres & Schools → closest parent academic department.

_DB_NAME_TO_SUBLABEL_KEY: dict[str, str] = {
    # Core academic departments (direct match)
    "Applied Mechanics":                           "Applied Mechanics",
    "Biochemical Engineering & Biotechnology":     "Biochemical Engineering and Biotechnology",
    "Chemical Engineering":                        "Chemical Engineering",
    "Chemistry Department":                        "Chemistry",
    "Civil Engineering":                           "Civil and Environmental Engineering",
    "Computer Science & Engineering":              "Computer Science and Engineering",
    "Department of Design":                        "Design",
    "Electrical Engineering":                      "Electrical Engineering",
    "Department of Energy Science & Engineering":  "Energy Science and Engineering",
    "Humanities & Social Sciences":                "Humanities and Social Sciences",
    "Department of Management Studies":            "Management Studies",
    "Materials Science & Engineering":             "Materials Science and Engineering",
    "Mathematics Department":                      "Mathematics",
    "Mechanical Engineering":                      "Mechanical Engineering",
    "Physics Department":                          "Physics",
    "Textile & Fibre Engineering":                 "Textile and Fibre Engineering",
    # Centres and Schools → closest academic parent
    "Centre for Biomedical Engineering":                            "Biochemical Engineering and Biotechnology",
    "Centre for Energy Studies":                                    "Energy Science and Engineering",
    "Department of Energy Science & Engineering":                   "Energy Science and Engineering",
    "School of AI":                                                 "Computer Science and Engineering",
    "School of Information Technology":                             "Computer Science and Engineering",
    "High Performance Computing Facility":                          "Computer Science and Engineering",
    "Centre for Applied Research in Electronics":                   "Electrical Engineering",
    "Electronics & Telecommunication Services Cell":                "Electrical Engineering",
    "Centre for Atmospheric Sciences":                              "Civil and Environmental Engineering",
    "Centre for Automotive Research and Tribology":                 "Mechanical Engineering",
    "Industrial Tribology & Machine Dynamics Centre":               "Mechanical Engineering",
    "School of Engineering & Applied Science":                      "Mechanical Engineering",
    "School of Biosciences":                                        "Biochemical Engineering and Biotechnology",
    "Department of Biotechnology":                                  "Biochemical Engineering and Biotechnology",
    "Biomedical Imaging & Research Division":                       "Biochemical Engineering and Biotechnology",
    "Centre for Polymer Science & Engineering (legacy Materials Science & Engineering Department)":
                                                                    "Materials Science and Engineering",
    "School of Public Policy":                                      "Humanities and Social Sciences",
    "Centre for Social Innovation & Entrepreneurship":              "Management Studies",
    "Centre for Rural Development and Technology":                  "Civil and Environmental Engineering",
    "Industrial Design & Development Centre":                       "Design",
    "School of Interdisciplinary Research":                         "Mechanical Engineering",
}

# Departments that are purely administrative — papers from these kerberoses
# get Level 2 determined by semantic similarity (no academic sub-label match).
_ADMIN_DEPT_NAMES: frozenset[str] = frozenset({
    "Administration", "Computer Centre", "Circulars & Official Notices",
    "Courses & Curriculum Office", "Central Research Facility",
    "Foundation for Innovation & Technology Transfer", "IIT Delhi Hospital",
    "Central Library", "National Centre for Training of Trainers",
    "National Resource Centre for Value Education", "Office of Planning & Coordination",
    "Industrial Research & Development Unit", "IRD Testing Division",
    "IIT Delhi – Abu Dhabi Campus", "Indian Institute of Technology Delhi",
    "Technology Research Park & Incubation Program",
    "UQ–IIT Delhi Academy of Research", "Visitors / Guest Access",
    "Old Phd Data", "IITD Externals",
})


# ==============================================================================
# Module-level embedding caches (lazy-loaded, computed once per process)
# ==============================================================================

_model: object = None
_theme_embeddings: np.ndarray | None = None    # shape: (9,  emb_dim)
_dept_embeddings: np.ndarray | None = None     # shape: (16, emb_dim)  — fallback only
_sublabel_cache: dict[str, np.ndarray] = {}    # sublabel_key → (n_sub, emb_dim)

# Kerberos → DB department name, loaded once from MongoDB at first use.
_kerberos_dept_map: dict[str, str] | None = None


def _get_model() -> object:
    """Lazily load and cache the sentence-transformer model (all-MiniLM-L6-v2)."""
    global _model
    if _model is None:
        try:
            from sentence_transformers import SentenceTransformer  # type: ignore[import]
        except ImportError as exc:
            raise ImportError(
                "Requires sentence-transformers.\n"
                "Install:  pip install sentence-transformers"
            ) from exc
        print(f"Loading model '{MODEL_NAME}' ...")
        _model = SentenceTransformer(MODEL_NAME)
        print("  Model ready.\n")
    return _model


def _get_theme_embeddings() -> np.ndarray:
    """Return cached embeddings for the 8 broad theme descriptions."""
    global _theme_embeddings
    if _theme_embeddings is None:
        _theme_embeddings = _get_model().encode(_BROAD_THEME_DESCRIPTIONS)  # type: ignore[attr-defined]
    return _theme_embeddings


def _get_dept_embeddings() -> np.ndarray:
    """Return cached embeddings for the 16 IITD department names."""
    global _dept_embeddings
    if _dept_embeddings is None:
        _dept_embeddings = _get_model().encode(IITD_DEPARTMENTS)  # type: ignore[attr-defined]
    return _dept_embeddings


def _get_sublabel_embeddings(sublabel_key: str) -> np.ndarray:
    """Return cached embeddings for the sub-domain labels of a department."""
    if sublabel_key not in _sublabel_cache:
        labels = DEPARTMENT_SUBLABELS.get(sublabel_key, [sublabel_key])
        _sublabel_cache[sublabel_key] = _get_model().encode(labels)  # type: ignore[attr-defined]
    return _sublabel_cache[sublabel_key]


def _load_kerberos_dept_map(
    mongo_uri: str = MONGO_URI,
    db_name: str = DB_NAME,
) -> dict[str, str]:
    """
    Build and cache a kerberos → DB department name lookup from MongoDB.

    JOIN CHAIN (read-only, no writes):
        researchmetadatascopus.kerberos
            → faculties.email  (prefix before '@')
            → faculties.department  (ObjectId)
            → departments._id  → departments.name

    The lookup is built once per process and cached in _kerberos_dept_map.
    Kerberos keys are stored lowercase for case-insensitive matching.

    Returns:
        Dict mapping lowercase kerberos string → department name string.
    """
    global _kerberos_dept_map
    if _kerberos_dept_map is not None:
        return _kerberos_dept_map

    try:
        import pymongo  # type: ignore[import]
    except ImportError as exc:
        raise ImportError(
            "kerberos lookup requires pymongo.\n"
            "Install:  pip install pymongo"
        ) from exc

    print("Building kerberos → department lookup from MongoDB ...")
    client: pymongo.MongoClient = pymongo.MongoClient(mongo_uri)
    db = client[db_name]

    # Step 1: load all departments  →  {OID string: department name}
    dept_by_oid: dict[str, str] = {
        str(d["_id"]): d.get("name", "")
        for d in db["departments"].find({}, {"_id": 1, "name": 1})
        if d.get("name")
    }

    # Step 2: load all faculties  →  extract kerberos from email, map to dept
    lookup: dict[str, str] = {}
    for fac in db["faculties"].find({}, {"email": 1, "department": 1}):
        email: str = (fac.get("email") or "").strip()
        dept_ref = fac.get("department")
        if "@" not in email or not dept_ref:
            continue
        kerberos: str = email.split("@")[0].strip().lower()
        dept_name: str = dept_by_oid.get(str(dept_ref), "")
        if kerberos and dept_name:
            lookup[kerberos] = dept_name

    client.close()

    _kerberos_dept_map = lookup
    print(f"  Loaded {len(lookup):,} kerberos → department mappings.\n")
    return _kerberos_dept_map


# ==============================================================================
# Core classifier
# ==============================================================================


def classify_paper(
    title: str,
    abstract: str,
    kerberos: str = "",
    field_associated: str = "",
) -> dict[str, str]:
    """
    Classify a paper into a 4-level IIT Delhi knowledge graph node path.

    LEVEL 1 — Broad Thematic Area
    --------------------------------
    Cosine similarity between the paper embedding and the 8 strategic theme
    descriptions.  Rich multi-keyword descriptions are used for embedding
    (not just the display names) to capture the full scope of each theme.
    Example: a paper on "convolutional neural network for image segmentation"
    → "AI/ML, Supercomputing & Quantum Computing"

    LEVEL 2 — IITD Department
    ---------------------------
    Cosine similarity against the 16 IITD department names.
    A soft prior from field_associated adds a small similarity boost (0.05×)
    toward departments aligned with the Scopus classification, preventing
    edge-case mis-assignments while letting content override when needed.
    Example: → "Computer Science and Engineering"

    LEVEL 3 — Sub-Domain
    ----------------------
    Cosine similarity against the curated sub-domain label list for the
    Level-2 department.
    Example: → "Computer Vision"

    LEVEL 4 — Topic  (YAKE leaf)
    ------------------------------
    YAKE extracts the single most distinctive technical keyphrase.
    Example: → "Image Segmentation"

    Args:
        title:            Raw paper title from MongoDB.
        abstract:         Raw paper abstract from MongoDB.
        kerberos:         paper.kerberos from MongoDB — primary key for dept lookup.
        field_associated: Scopus field_associated — used only in fallback path.

    Returns:
        Dict with keys: broad_theme, iitd_department, dept_source, sub_domain, topic.
        dept_source is "DB", "Semantic", or "Admin-Fallback" so you can audit
        how each department assignment was made.
    """
    # ------------------------------------------------------------------
    # Prepare paper text
    # ------------------------------------------------------------------
    clean_title: str = clean_raw_text(title)
    clean_abstract: str = clean_raw_text(abstract)
    if is_placeholder_abstract(clean_abstract):
        clean_abstract = ""
    paper_text: str = (
        f"{clean_title}. {clean_abstract}" if clean_abstract else clean_title
    )

    if not paper_text.strip():
        return {
            "broad_theme": BROAD_THEME_NAMES[0],
            "iitd_department": IITD_DEPARTMENTS[0],
            "dept_source": "Fallback",
            "sub_domain": DEPARTMENT_SUBLABELS[IITD_DEPARTMENTS[0]][0],
            "topic": "Research Topic",
        }

    model = _get_model()
    paper_emb: np.ndarray = model.encode([paper_text])  # type: ignore[attr-defined]

    # ------------------------------------------------------------------
    # Level 1 — Broad Thematic Area
    # ------------------------------------------------------------------
    theme_sims: np.ndarray = cosine_similarity(paper_emb, _get_theme_embeddings())[0]
    broad_theme: str = BROAD_THEME_NAMES[int(np.argmax(theme_sims))]

    # ------------------------------------------------------------------
    # Level 2 — IITD Department  (STRICT DB lookup, semantic fallback)
    # ------------------------------------------------------------------
    kerberos_map = _load_kerberos_dept_map()
    kb_key: str = (kerberos or "").strip().lower()
    db_dept_name: str = kerberos_map.get(kb_key, "")

    iitd_dept: str
    dept_source: str

    if db_dept_name and db_dept_name not in _ADMIN_DEPT_NAMES:
        # Primary path: kerberos found in DB and maps to an academic department
        iitd_dept = db_dept_name
        dept_source = "DB"
    else:
        # Fallback: semantic similarity against the 16 canonical IITD department names
        dept_sims: np.ndarray = cosine_similarity(paper_emb, _get_dept_embeddings())[0]
        if field_associated and field_associated.strip():
            fa_emb: np.ndarray = model.encode([field_associated.strip()])  # type: ignore[attr-defined]
            fa_sims: np.ndarray = cosine_similarity(fa_emb, _get_dept_embeddings())[0]
            dept_sims = dept_sims + 0.05 * fa_sims
        iitd_dept = IITD_DEPARTMENTS[int(np.argmax(dept_sims))]
        dept_source = "Semantic" if not db_dept_name else "Admin-Fallback"

    # ------------------------------------------------------------------
    # Level 3 — Sub-Domain  (DB name → sublabel key → cosine similarity)
    # ------------------------------------------------------------------
    sublabel_key: str = _DB_NAME_TO_SUBLABEL_KEY.get(iitd_dept, iitd_dept)
    sub_labels: list[str] = DEPARTMENT_SUBLABELS.get(sublabel_key, [iitd_dept])

    sub_sims: np.ndarray = cosine_similarity(
        paper_emb, _get_sublabel_embeddings(sublabel_key)
    )[0]
    sub_domain: str = (
        sub_labels[int(np.argmax(sub_sims))]
        if float(np.max(sub_sims)) >= _MIN_SIMILARITY
        else iitd_dept
    )

    # ------------------------------------------------------------------
    # Level 4 — YAKE leaf topic
    # ------------------------------------------------------------------
    leaf: list[str] = extract_academic_keywords(title, abstract, top_n=1)
    topic: str = leaf[0] if leaf[0] != "Research Topic" else sub_domain

    return {
        "broad_theme": broad_theme,
        "iitd_department": iitd_dept,
        "dept_source": dept_source,
        "sub_domain": sub_domain,
        "topic": topic,
    }


# ==============================================================================
# Parallel helpers
# ==============================================================================


def _yake_worker(args: tuple[int, list[tuple[str, str]]]) -> tuple[int, list[str]]:
    """
    Module-level worker function for ProcessPoolExecutor.

    Must be at module level (not nested) so multiprocessing can pickle it.
    Each worker process creates its own YAKE extractor instance.

    Args:
        args: (start_index, [(title, abstract), ...]) chunk tuple.

    Returns:
        (start_index, [topic_string, ...]) — original index preserved for
        reassembly after parallel execution.
    """
    start_idx, pairs = args
    # Import inside worker so each process gets its own module state
    from keyword_extractor import extract_academic_keywords  # type: ignore[import]
    topics: list[str] = []
    for title, abstract in pairs:
        kws = extract_academic_keywords(title, abstract, top_n=1)
        topics.append(kws[0] if kws[0] != "Research Topic" else "")
    return start_idx, topics


def _compute_subdomains_batch(
    paper_embs: np.ndarray,
    dept_names: list[str],
) -> list[str]:
    """
    Vectorized sub-domain assignment for N papers in a single pass.

    Groups papers by their DEPARTMENT_SUBLABELS key, then runs one cosine
    similarity matrix operation per group instead of one per paper.
    This reduces N individual cosine calls to at most len(DEPARTMENT_SUBLABELS)
    group-level matrix multiplications.

    Args:
        paper_embs: (N, emb_dim) embedding matrix for all papers.
        dept_names: List of N department name strings (Level 2 results).

    Returns:
        List of N sub-domain label strings.
    """
    from collections import defaultdict
    n = len(dept_names)
    sub_domains: list[str] = [""] * n

    # Group paper indices by their sublabel vocabulary key
    groups: dict[str, list[int]] = defaultdict(list)
    for i, dept in enumerate(dept_names):
        key = _DB_NAME_TO_SUBLABEL_KEY.get(dept, dept)
        groups[key].append(i)

    for sublabel_key, indices in groups.items():
        labels: list[str] = DEPARTMENT_SUBLABELS.get(sublabel_key, [sublabel_key])
        label_embs: np.ndarray = _get_sublabel_embeddings(sublabel_key)
        # Slice only this group's embeddings — single matrix op for the whole group
        group_embs: np.ndarray = paper_embs[np.array(indices)]       # (m, dim)
        sims: np.ndarray = cosine_similarity(group_embs, label_embs)  # (m, n_labels)
        best_label_idx: np.ndarray = np.argmax(sims, axis=1)
        best_scores: np.ndarray = np.max(sims, axis=1)

        for j, i in enumerate(indices):
            sub_domains[i] = (
                labels[int(best_label_idx[j])]
                if float(best_scores[j]) >= _MIN_SIMILARITY
                else sublabel_key
            )

    return sub_domains


# ==============================================================================
# Parallel batch classifier — full corpus
# ==============================================================================


def run_batch_classification(
    mongo_uri: str = MONGO_URI,
    db_name: str = DB_NAME,
    collection: str = COLLECTION,
    limit: int = 100,
    output_path: str = "classified_papers.xlsx",
    n_workers: int | None = None,
    encode_batch_size: int = 256,
) -> None:
    """
    Classify `limit` papers into 4-level IITD KG node paths using all CPU cores.

    PARALLELISATION STRATEGY
    ------------------------
    The original per-paper loop called model.encode() 69 K times and ran YAKE
    serially — far below the machine's throughput capacity.

    This version uses three optimisations:

    1. BATCH SENTENCE ENCODING
       All paper texts are encoded in a single model.encode(..., batch_size=N)
       call.  sentence-transformers handles internal batching and uses every
       available CPU thread via PyTorch.  This turns O(N) individual inference
       calls into one vectorised pass (~30 s for 70 K papers on CPU).

    2. VECTORISED COSINE SIMILARITY
       Levels 1 (theme) and 2 (dept fallback) are computed as single matrix
       multiplications across all N papers:
           cosine_similarity(paper_embs, theme_embs)  → (N, 9)
           cosine_similarity(paper_embs, dept_embs)   → (N, 16)
       Level 3 (sub-domain) is grouped by department and run as one matrix op
       per department — at most 16 matrix ops total regardless of N.

    3. PARALLEL YAKE EXTRACTION
       YAKE is pure Python and CPU-bound.  Papers are split into equal chunks
       and distributed across all logical cores (performance + efficiency) using
       ProcessPoolExecutor.  Each worker process creates its own YAKE instance,
       fully utilising every core.

    DEPT_SOURCE AUDIT COLUMN
    -------------------------
    "DB"             — department taken from kerberos → faculty → departments
    "Semantic"       — kerberos not in DB; sentence-transformer cosine fallback
    "Admin-Fallback" — kerberos found but maps to an admin unit; cosine fallback

    Args:
        mongo_uri:         MongoDB connection string.
        db_name:           Database name.
        collection:        Collection name.
        limit:             Max documents to process (0 = all).
        output_path:       Output Excel file path.
        n_workers:         CPU worker count for YAKE (default: all logical cores).
        encode_batch_size: Batch size for sentence-transformer encoding.
    """
    import os
    import time
    from concurrent.futures import ProcessPoolExecutor

    try:
        import pymongo       # type: ignore[import]
        import pandas as pd  # type: ignore[import]
    except ImportError as exc:
        raise ImportError(
            "Requires pymongo and pandas.\n"
            "Install:  pip install pymongo pandas openpyxl"
        ) from exc

    n_workers = n_workers or os.cpu_count() or 1
    t0 = time.time()

    # ------------------------------------------------------------------
    # Phase 1 — Fetch all documents from MongoDB
    # ------------------------------------------------------------------
    print(f"[1/5] Connecting to MongoDB ({mongo_uri.split('@')[-1]}) ...")
    client: pymongo.MongoClient = pymongo.MongoClient(mongo_uri)
    col = client[db_name][collection]

    cursor = col.find(
        filter={},
        projection={
            "title": 1, "abstract": 1,
            "field_associated": 1, "kerberos": 1,
            "_id": 0,
        },
    )
    if limit and limit > 0:
        cursor = cursor.limit(limit)

    print("      Fetching documents ...")
    docs: list[dict] = list(cursor)
    client.close()
    n = len(docs)
    print(f"      {n:,} documents fetched  ({time.time()-t0:.1f}s)\n")

    # ------------------------------------------------------------------
    # Phase 2 — Prepare paper texts + kerberos dept lookup
    # ------------------------------------------------------------------
    print("[2/5] Preparing texts and kerberos → department lookup ...")
    kerberos_map = _load_kerberos_dept_map(mongo_uri, db_name)

    paper_texts: list[str] = []
    for doc in docs:
        ct = clean_raw_text(doc.get("title") or "")
        ca = clean_raw_text(doc.get("abstract") or "")
        if is_placeholder_abstract(ca):
            ca = ""
        paper_texts.append(f"{ct}. {ca}" if ca else ct)

    print(f"      Done  ({time.time()-t0:.1f}s)\n")

    # ------------------------------------------------------------------
    # Phase 3 — Batch encode ALL paper texts in one model pass
    # ------------------------------------------------------------------
    print(f"[3/5] Batch encoding {n:,} papers  (batch_size={encode_batch_size}) ...")
    model = _get_model()
    paper_embs: np.ndarray = model.encode(  # type: ignore[attr-defined]
        paper_texts,
        batch_size=encode_batch_size,
        show_progress_bar=True,
        convert_to_numpy=True,
    )
    print(f"      Encoding done  ({time.time()-t0:.1f}s)\n")

    # ------------------------------------------------------------------
    # Phase 4 — Vectorised classification: Levels 1, 2, 3
    # ------------------------------------------------------------------
    print("[4/5] Vectorised cosine classification (Levels 1–3) ...")

    # Level 1 — Broad Theme: single (N × 9) matrix op
    theme_sims: np.ndarray = cosine_similarity(paper_embs, _get_theme_embeddings())
    theme_indices: np.ndarray = np.argmax(theme_sims, axis=1)

    # Level 2 — IITD Department: kerberos DB lookup first, cosine fallback
    dept_embs: np.ndarray = _get_dept_embeddings()
    # Compute fallback cosine sims for all papers upfront (used only for non-DB papers)
    dept_sims_all: np.ndarray = cosine_similarity(paper_embs, dept_embs)  # (N, 16)

    iitd_depts: list[str] = []
    dept_sources: list[str] = []

    for i, doc in enumerate(docs):
        kb: str = (doc.get("kerberos") or "").strip().lower()
        db_dept: str = kerberos_map.get(kb, "")

        if db_dept and db_dept not in _ADMIN_DEPT_NAMES:
            iitd_depts.append(db_dept)
            dept_sources.append("DB")
        else:
            sims = dept_sims_all[i].copy()
            fa: str = (doc.get("field_associated") or "").strip()
            if fa:
                fa_emb: np.ndarray = model.encode([fa])  # type: ignore[attr-defined]
                fa_sims: np.ndarray = cosine_similarity(fa_emb, dept_embs)[0]
                sims = sims + 0.05 * fa_sims
            iitd_depts.append(IITD_DEPARTMENTS[int(np.argmax(sims))])
            dept_sources.append("Semantic" if not db_dept else "Admin-Fallback")

    # Level 3 — Sub-Domain: grouped vectorised ops (one matrix multiply per dept)
    sub_domains: list[str] = _compute_subdomains_batch(paper_embs, iitd_depts)

    print(f"      Levels 1–3 done  ({time.time()-t0:.1f}s)\n")

    # ------------------------------------------------------------------
    # Phase 5 — Parallel YAKE extraction (Level 4) across all CPU cores
    # ------------------------------------------------------------------
    print(f"[5/5] Parallel YAKE extraction on {n_workers} CPU cores ...")

    pairs: list[tuple[str, str]] = [
        (doc.get("title") or "", doc.get("abstract") or "")
        for doc in docs
    ]

    # Split into equal chunks — one per worker
    chunk_size: int = max(1, (n + n_workers - 1) // n_workers)
    chunks: list[tuple[int, list[tuple[str, str]]]] = [
        (start, pairs[start : start + chunk_size])
        for start in range(0, n, chunk_size)
    ]

    topics: list[str] = [""] * n
    with ProcessPoolExecutor(max_workers=n_workers) as executor:
        for start_idx, result_topics in executor.map(_yake_worker, chunks):
            for j, topic in enumerate(result_topics):
                topics[start_idx + j] = topic

    # Post-process: if YAKE returned empty, fall back to sub_domain
    for i in range(n):
        if not topics[i]:
            topics[i] = sub_domains[i]

    print(f"      YAKE done  ({time.time()-t0:.1f}s)\n")

    # ------------------------------------------------------------------
    # Assemble results
    # ------------------------------------------------------------------
    rows: list[dict[str, str]] = [
        {
            "Title":           docs[i].get("title") or "",
            "Kerberos":        (docs[i].get("kerberos") or "").strip(),
            "Broad_Theme":     BROAD_THEME_NAMES[int(theme_indices[i])],
            "IITD_Department": iitd_depts[i],
            "Dept_Source":     dept_sources[i],
            "Sub_Domain":      sub_domains[i],
            "Topic":           topics[i],
        }
        for i in range(n)
    ]

    df = pd.DataFrame(rows)

    # Split into two groups:
    #   • "Classified"     — DB-resolved papers (kerberos → known academic dept)
    #   • "Admin_Fallback" — kerberos maps to an administrative/non-academic unit;
    #                        department was inferred by semantic similarity only.
    #                        These need manual review before loading into Neo4j.
    df_classified: pd.DataFrame = df[df["Dept_Source"] != "Admin-Fallback"].copy()
    df_admin: pd.DataFrame      = df[df["Dept_Source"] == "Admin-Fallback"].copy()

    # Write both groups as separate sheets in the same workbook
    with pd.ExcelWriter(output_path, engine="openpyxl") as writer:
        df_classified.to_excel(writer, sheet_name="Classified",     index=False)
        df_admin.to_excel(     writer, sheet_name="Admin_Fallback",  index=False)

    elapsed   = time.time() - t0
    db_count  = (df["Dept_Source"] == "DB").sum()
    sem_count = (df["Dept_Source"] == "Semantic").sum()
    adm_count = len(df_admin)

    print(f"Done in {elapsed:.1f}s  ({n/elapsed:.0f} papers/sec)")
    print(f"Results saved to: {output_path}")
    print(f"  Sheet 'Classified'    — {len(df_classified):,} papers  (DB: {db_count:,} | Semantic: {sem_count:,})")
    print(f"  Sheet 'Admin_Fallback'— {adm_count:,} papers  (kerberos → admin unit; dept inferred)")
    print()
    print("Preview — Classified (first 10 rows):")
    print(
        df_classified[["Title", "Broad_Theme", "IITD_Department", "Sub_Domain", "Topic"]]
        .head(10)
        .to_string(index=False)
    )
    if adm_count:
        print(f"\nPreview — Admin_Fallback (first 5 rows):")
        print(
            df_admin[["Title", "Kerberos", "IITD_Department", "Sub_Domain", "Topic"]]
            .head(5)
            .to_string(index=False)
        )
    print()


# ==============================================================================
# Entry point
# ==============================================================================

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="4-level IITD KG classifier — parallelised across all CPU cores."
    )
    parser.add_argument(
        "--limit", type=int, default=0,
        help="Max papers to classify (0 = full corpus, default: 0).",
    )
    parser.add_argument(
        "--output", type=str, default="classified_papers.xlsx",
        help="Output Excel file path.",
    )
    parser.add_argument(
        "--workers", type=int, default=None,
        help="Number of CPU workers for YAKE (default: all logical cores).",
    )
    parser.add_argument(
        "--batch-size", type=int, default=256,
        help="Sentence-transformer encoding batch size (default: 256).",
    )
    args = parser.parse_args()

    run_batch_classification(
        limit=args.limit,
        output_path=args.output,
        n_workers=args.workers,
        encode_batch_size=args.batch_size,
    )
