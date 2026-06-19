# ==============================================================================
# keyword_extractor.py
#
# Production-ready YAKE-based academic keyword extractor for knowledge graph
# sub-topic node generation. Runs entirely locally on CPU — no cloud APIs used.
#
# LOCAL INSTALLATION (one-time setup):
#   pip install yake pymongo pandas openpyxl
#
# YAKE paper:  Campos et al. (2020)  https://github.com/LIAAD/yake
# ==============================================================================

from __future__ import annotations

import html
import re
import string
from typing import Optional

import yake


# ==============================================================================
# Constants
# ==============================================================================

# Known placeholder strings written into the abstract field by the Scopus
# importer when no real abstract was available.  Stored as normalized lowercase
# for case-insensitive comparison.  Without this guard, YAKE would happily
# extract "No Abstract Available" as the top sub-topic node name.
_PLACEHOLDER_ABSTRACTS: frozenset[str] = frozenset(
    {
        "(no abstract available)",
        "no abstract available",
        "abstract not available",
        "no abstract",
    }
)

# Generic fallback phrase inserted when YAKE cannot produce enough results
# (e.g., the combined text is too short for statistical scoring).
_FALLBACK_KEYWORD: str = "Research Topic"

# Characters that must never appear at the leading or trailing edge of a
# node name.  Covers all ASCII punctuation + common Unicode math symbols.
_STRIP_CHARS: str = string.punctuation + "©®™°∑∏√∞≠≤≥±×÷"


# ==============================================================================
# 1. Text Cleaning
# ==============================================================================


def clean_raw_text(text: str) -> str:
    """
    Remove structural noise from a raw Scopus title or abstract string while
    **preserving the original casing** of every word.

    WHY CASING MUST BE PRESERVED
    -----------------------------
    YAKE's statistical model treats uppercase letters and acronyms as strong
    indicators of term importance.  The word "CO2" scores very differently from
    "co2" in YAKE's internal frequency and co-occurrence tables.  Lowercasing
    the input before calling YAKE would collapse acronyms like "CO2", "Ansys",
    and "Chemkin Pro" into ordinary lowercase tokens, destroying the very
    feature signal YAKE depends on and producing inferior keyword extractions.

    Noise patterns handled (in order of application):
        1. HTML entity unescaping  (&amp; → &,  &#169; → ©,  etc.)
        2. HTML / XML tag removal  (<sup>text</sup>  →  text)
        3. Web URL removal         (http://..., https://..., www....)
        4. Copyright trailer strip (everything from © or "Copyright" onward)
           Real Scopus abstracts end with "... social search. © 2009 IEEE."
        5. Smart / escaped quote normalization  (\"semantic gap\" → 'semantic gap')
        6. Whitespace normalization (tabs, newlines, double spaces → single space)

    Args:
        text: Raw string from the MongoDB document (title or abstract field).

    Returns:
        Cleaned string ready to be passed to YAKE — original casing intact.
        Returns "" for None, empty, or whitespace-only input.
    """
    if not text or not text.strip():
        return ""

    # Step 1 — Unescape HTML entities.
    # Scopus occasionally stores entities like &lt; or &amp; in its metadata.
    text = html.unescape(text)

    # Step 2 — Strip HTML / XML tags.
    # Defensive guard; Scopus data appears to be plain text but edge cases exist.
    text = re.sub(r"<[^>]+>", " ", text)

    # Step 3 — Remove URLs.
    # Any http/https/ftp URL and bare www. addresses are replaced with a space
    # so surrounding words are not accidentally concatenated.
    text = re.sub(r"https?://\S+|ftp://\S+|www\.\S+", " ", text)

    # Step 4 — Strip copyright / publisher trailers.
    # Matches the © symbol (after HTML unescaping) and the word "Copyright"
    # (case-insensitive).  The re.DOTALL flag makes . match newlines as well,
    # which handles multi-line copyright blocks.
    text = re.sub(r"©.*$", "", text, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"\bCopyright\b.*$", "", text, flags=re.IGNORECASE | re.DOTALL)

    # Step 5 — Normalize smart / curly / escaped quotes to plain ASCII.
    # Real Scopus abstracts contain sequences like:  the \"semantic gap\"
    # YAKE tokenizes on whitespace and punctuation, so stray backslash-quote
    # artifacts would split multi-word phrases incorrectly.
    text = re.sub(r'[\u201c\u201d\u201e\u201f\u2018\u2019\\"]', "'", text)

    # Step 6 — Collapse any sequence of whitespace (spaces, tabs, newlines)
    # into a single space and remove leading/trailing whitespace.
    text = re.sub(r"\s+", " ", text).strip()

    return text


def is_placeholder_abstract(text: str) -> bool:
    """
    Return True when the cleaned abstract contains only a known placeholder
    value rather than real content.

    The Scopus importer in this project stores the literal string
    "(No abstract available)" instead of leaving the field null or empty when
    no abstract was retrieved from the API.  Without this guard,
    `extract_academic_keywords` would return ["No Abstract Available", ...]
    as node names for every such paper.

    Args:
        text: Cleaned (but not lowercased) abstract string.

    Returns:
        True if the normalized text matches a recognized placeholder.
    """
    return text.strip().lower() in _PLACEHOLDER_ABSTRACTS


# ==============================================================================
# 2. YAKE Extractor Configuration
# ==============================================================================


def _compute_dynamic_ngram(word_count: int) -> int:
    """
    Choose the maximum n-gram length based on how many words are available.

    WHY THIS MATTERS
    ----------------
    With a fixed n=3 and a short title (no abstract), YAKE generates every
    overlapping 3-word window from the title as a candidate — e.g. for
    "bio-inspired gyroid cellular architectured metabeam" it produces:
        "bio-inspired gyroid cellular"
        "gyroid cellular architectured"
        "cellular architectured metabeam"
    These are all statistically indistinguishable on a short text, so YAKE
    returns them all, leading to three near-identical keywords.

    The fix is to shrink the n-gram window when the text is short, so YAKE
    works with building blocks it can actually differentiate:
        < 25 words  → n=1  title-only / very short: best single keyword token
        25–70 words → n=2  short abstract: 2-word technical phrases
        > 70 words  → n=3  full abstract: up to 3-word composite terms

    Args:
        word_count: Number of whitespace-separated tokens in the combined text.

    Returns:
        Integer n-gram size (1, 2, or 3).
    """
    if word_count < 25:
        return 1
    elif word_count < 70:
        return 2
    else:
        return 3


def _build_extractor(n: int, candidate_pool: int) -> yake.KeywordExtractor:
    """
    Instantiate and return a YAKE KeywordExtractor tuned for academic text.

    PARAMETER RATIONALE
    -------------------
    lan = "en"
        Selects the English stopword list and sentence tokenizer.  Using the
        correct language prevents common English function words ("the", "a",
        "of") from being scored as keywords.

    n  (dynamic — see _compute_dynamic_ngram)
        Maximum n-gram length.  Sized to the available text so YAKE only
        generates phrases it can statistically distinguish.  Long abstracts
        use n=3 for rich composite terms; short / title-only texts use n=1
        or n=2 to prevent sliding-window duplication.

    dedupLim = 0.75
        Deduplication threshold (range 0–1; lower = stricter).  Tightened
        from 0.85 to 0.75 so that near-synonym phrases like "CO2 storage"
        and "CO2 storage mechanism" are collapsed more aggressively inside
        YAKE itself, before our own post-filter runs.

    dedupFunc = "seqm"
        Uses Python's difflib SequenceMatcher for similarity comparison.
        More accurate for multi-word technical phrases than Levenshtein.

    windowsSize = 1
        Context window for co-occurrence scoring.  Immediate-neighbor only;
        appropriate for dense academic sentences.

    top = candidate_pool
        YAKE is asked for more candidates than we ultimately need
        (top_n × 3) so the post-extraction overlap filter has a larger pool
        to choose distinct phrases from before returning the final top_n.

    Args:
        n:              Maximum n-gram length (1, 2, or 3).
        candidate_pool: Number of raw candidates to retrieve from YAKE.

    Returns:
        Configured yake.KeywordExtractor ready for extraction.
    """
    return yake.KeywordExtractor(
        lan="en",
        n=n,
        dedupLim=0.75,
        dedupFunc="seqm",
        windowsSize=1,
        top=candidate_pool,
    )


# ==============================================================================
# 3. Output Formatting Guardrails & Post-Deduplication
# ==============================================================================


def _format_phrase(phrase: str) -> str:
    """
    Convert a raw YAKE output phrase into a clean, graph-node-safe Title Case
    string.

    Guardrails applied:
        1. Strip leading/trailing noise characters — punctuation, math symbols,
           copyright/trademark markers.
        2. Remove single-character tokens — artifacts like "-", "2", or "a"
           that appear after punctuation stripping and would produce invalid
           node name fragments.
        3. Apply Title Case — first letter of each word capitalized so the
           phrase reads naturally as a knowledge graph node label.

    Args:
        phrase: Raw keyword string from a YAKE (phrase, score) tuple.

    Returns:
        Clean title-cased string suitable for a Neo4j node name.
        Returns "" if the phrase is empty or reduces to nothing after cleaning.
    """
    if not phrase:
        return ""

    # Step 1 — Strip leading / trailing noise characters from the whole phrase.
    phrase = phrase.strip(_STRIP_CHARS).strip()

    # Step 2 — Split on whitespace and remove single-character tokens.
    # Single-char tokens are almost always punctuation artifacts or Roman
    # numerals that snuck through (e.g., "CO 2" splitting to ["CO", "2"]).
    tokens: list[str] = [
        tok for tok in phrase.split()
        if len(tok.strip(_STRIP_CHARS)) > 1
    ]

    if not tokens:
        return ""

    phrase = " ".join(tokens)

    # Step 3 — Title Case: capitalizes the first letter of every word.
    return phrase.title()


def _remove_overlapping_phrases(phrases: list[str]) -> list[str]:
    """
    Remove phrases that share too many words with a phrase already accepted
    into the result list.

    WHY THIS IS NEEDED
    ------------------
    Even after YAKE's internal deduplication, short texts (title-only or
    single-sentence abstracts) can still yield near-identical sliding-window
    candidates that passed YAKE's threshold:
        "Carbon Dioxide Storage"
        "Dioxide Storage Conversion"
        "Storage And Conversion"
    All three share 2 of 3 words with a neighbour, so they are functionally
    duplicate node names.

    ALGORITHM
    ---------
    Phrases are considered overlapping if the Jaccard similarity of their
    lowercased word sets exceeds _OVERLAP_THRESHOLD (0.6).  We iterate in
    YAKE's score order (best first) and keep a phrase only if it is not too
    similar to any phrase already accepted.

    Args:
        phrases: Formatted, title-cased phrases in best-first order.

    Returns:
        Filtered list with overlapping duplicates removed; order preserved.
    """
    _OVERLAP_THRESHOLD: float = 0.6

    accepted: list[str] = []
    accepted_word_sets: list[set[str]] = []

    for phrase in phrases:
        candidate_words: set[str] = set(phrase.lower().split())
        if not candidate_words:
            continue

        is_redundant: bool = False
        for kept_words in accepted_word_sets:
            # Subset check: "Pro" ⊂ "Chemkin Pro" → always redundant regardless
            # of Jaccard, because it adds no new information to the node list.
            if candidate_words.issubset(kept_words) or candidate_words.issuperset(kept_words):
                is_redundant = True
                break
            union_size = len(candidate_words | kept_words)
            if union_size == 0:
                continue
            jaccard: float = len(candidate_words & kept_words) / union_size
            if jaccard > _OVERLAP_THRESHOLD:
                is_redundant = True
                break

        if not is_redundant:
            accepted.append(phrase)
            accepted_word_sets.append(candidate_words)

    return accepted


# ==============================================================================
# 4. Core Extraction Function
# ==============================================================================


def extract_academic_keywords(
    title: str,
    abstract: str,
    top_n: int = 3,
) -> list[str]:
    """
    Extract up to `top_n` distinct technical keyphrases from a research
    paper's title and abstract.

    Intended use: generating Sub-Topic node names for a Neo4j knowledge graph.
    Runs entirely locally — no network calls, no cloud APIs.

    DYNAMIC N-GRAM STRATEGY
    -----------------------
    The maximum n-gram size is chosen dynamically from the combined word count
    (see _compute_dynamic_ngram).  This prevents the "sliding window" problem
    where a fixed n=3 on a short title produces nearly identical 3-gram
    candidates that are all subsets of each other.

    COMBINATION STRATEGY
    --------------------
    When a real abstract is available, the title is prepended once to the
    abstract so YAKE gives it slightly higher positional weight.  The previous
    double-repeat of the title has been removed: on title-only documents it
    was inflating every title n-gram's score equally, eliminating diversity.

    CANDIDATE OVER-FETCH
    --------------------
    YAKE is asked for top_n × 3 candidates instead of exactly top_n.  The
    extra pool allows the post-extraction overlap filter to remove redundant
    near-duplicates and still return top_n genuinely distinct phrases.

    OVERLAP DEDUPLICATION
    ---------------------
    After YAKE's own dedup, _remove_overlapping_phrases applies a second
    Jaccard-similarity pass (threshold 0.6).  This catches sliding-window
    duplicates that survive YAKE's sequence-matcher check.

    DYNAMIC RETURN COUNT
    --------------------
    If the text is too sparse to produce top_n distinct phrases, the function
    returns only what it found (no duplicates) and pads remaining slots with
    _FALLBACK_KEYWORD.  The caller always gets a list of exactly top_n items.

    PLACEHOLDER HANDLING
    --------------------
    Abstracts containing the literal string "(No abstract available)" are
    silently dropped; extraction runs on the title alone.

    Args:
        title:    Paper title string (raw, directly from the database).
        abstract: Paper abstract string (raw, directly from the database).
        top_n:    Maximum number of keyphrases to return (default 3).

    Returns:
        List of exactly `top_n` title-cased keyphrase strings.
        Slots that could not be filled by unique YAKE phrases contain
        _FALLBACK_KEYWORD ("Research Topic").
    """
    # -------------------------------------------------------------------------
    # Clean inputs — preserve casing
    # -------------------------------------------------------------------------
    clean_title: str = clean_raw_text(title)
    clean_abstract: str = clean_raw_text(abstract)

    # -------------------------------------------------------------------------
    # Placeholder guard
    # -------------------------------------------------------------------------
    if is_placeholder_abstract(clean_abstract):
        clean_abstract = ""

    # -------------------------------------------------------------------------
    # Build combined text block (title prepended once for positional weight)
    # -------------------------------------------------------------------------
    if clean_abstract:
        combined_text: str = f"{clean_title}. {clean_abstract}"
    else:
        # Title-only: no artificial repetition — YAKE should work on what
        # genuinely exists rather than on an inflated duplicate signal.
        combined_text = clean_title

    # -------------------------------------------------------------------------
    # Minimum-length guard
    # -------------------------------------------------------------------------
    words: list[str] = combined_text.split()
    if len(words) < 4:
        return [_FALLBACK_KEYWORD] * top_n

    # -------------------------------------------------------------------------
    # Dynamic n-gram size
    # -------------------------------------------------------------------------
    max_ngram: int = _compute_dynamic_ngram(len(words))

    # Ask YAKE for 3× more candidates than needed so the overlap filter has
    # a sufficient pool to pick top_n truly distinct phrases from.
    candidate_pool: int = top_n * 3

    # -------------------------------------------------------------------------
    # YAKE extraction
    # -------------------------------------------------------------------------
    extractor: yake.KeywordExtractor = _build_extractor(max_ngram, candidate_pool)

    try:
        # YAKE returns (phrase, score) tuples — lower score = more relevant.
        # The list is already sorted ascending (best first).
        raw_keywords: list[tuple[str, float]] = extractor.extract_keywords(combined_text)
    except Exception:
        return [_FALLBACK_KEYWORD] * top_n

    # -------------------------------------------------------------------------
    # Strip scores, format, remove empties
    # -------------------------------------------------------------------------
    formatted: list[str] = [_format_phrase(phrase) for phrase, _ in raw_keywords]
    phrases: list[str] = [p for p in formatted if p]

    # -------------------------------------------------------------------------
    # Post-extraction overlap deduplication
    # -------------------------------------------------------------------------
    # Removes near-duplicate sliding-window phrases that survived YAKE's own
    # internal dedup (e.g. "Gyroid Cellular Architectured" vs
    # "Cellular Architectured Metabeam" — 2/4 words in common → Jaccard 0.67).
    phrases = _remove_overlapping_phrases(phrases)

    # -------------------------------------------------------------------------
    # Trim to top_n, then pad remaining slots with the generic fallback.
    # Padding uses _FALLBACK_KEYWORD — never repeats an extracted phrase —
    # so duplicate keywords never appear in the output.
    # -------------------------------------------------------------------------
    phrases = phrases[:top_n]
    while len(phrases) < top_n:
        phrases.append(_FALLBACK_KEYWORD)

    return phrases


# ==============================================================================
# 5. Batch Processor — Top N Papers from MongoDB → Excel
# ==============================================================================


def run_batch_extraction(
    connection_string: str = "mongodb://admin:password@10.17.8.24/admin",
    database: str = "research_ambit",
    collection: str = "researchmetadatascopus",
    limit: int = 100,
    output_path: str = "keywords_top100.xlsx",
    top_n: int = 3,
) -> None:
    """
    Fetch the first `limit` papers from MongoDB, run keyword extraction on
    each, and write a summary Excel file.

    The Excel output contains one row per paper with columns:
        Title | Keyword_1 | Keyword_2 | Keyword_3

    Only `title` and `abstract` fields are fetched from MongoDB — all other
    fields are excluded from the query projection for efficiency.

    Args:
        connection_string: MongoDB URI (includes auth credentials).
        database:          Target database name.
        collection:        Target collection name.
        limit:             Maximum number of documents to process (default 100).
        output_path:       Filesystem path for the output .xlsx file.
        top_n:             Number of keywords to extract per paper (default 3).

    Raises:
        ImportError: If pymongo, pandas, or openpyxl are not installed.
    """
    try:
        import pymongo          # type: ignore[import]
        import pandas as pd     # type: ignore[import]
    except ImportError as exc:
        raise ImportError(
            "Batch mode requires pymongo and pandas.\n"
            "Install with:  pip install pymongo pandas openpyxl"
        ) from exc

    # Mask credentials in the console log
    host_display: str = connection_string.split("@")[-1]
    print(f"\nConnecting to MongoDB  ({host_display}) ...")

    client: pymongo.MongoClient = pymongo.MongoClient(connection_string)
    col = client[database][collection]

    # Project only the two fields we need; sorted by _id (insertion order)
    # for reproducible results across runs.
    cursor = col.find(
        filter={},
        projection={"title": 1, "abstract": 1, "_id": 0},
    ).limit(limit)

    print(f"Processing up to {limit} documents from '{database}.{collection}' ...\n")

    rows: list[dict[str, str]] = []

    for i, doc in enumerate(cursor, start=1):
        raw_title: str = doc.get("title") or ""
        raw_abstract: str = doc.get("abstract") or ""

        keywords: list[str] = extract_academic_keywords(
            raw_title, raw_abstract, top_n=top_n
        )

        row: dict[str, str] = {"Title": raw_title}
        for idx, kw in enumerate(keywords, start=1):
            row[f"Keyword_{idx}"] = kw

        rows.append(row)

        # Progress indicator every 10 documents
        if i % 10 == 0:
            print(f"  [{i:>3}/{limit}] processed ...")

    client.close()

    # ------------------------------------------------------------------
    # Build DataFrame and export to Excel
    # ------------------------------------------------------------------
    df = pd.DataFrame(rows)

    # Ensure keyword columns appear in order even if top_n varies
    keyword_cols: list[str] = [f"Keyword_{i}" for i in range(1, top_n + 1)]
    ordered_cols: list[str] = ["Title"] + [c for c in keyword_cols if c in df.columns]
    df = df[ordered_cols]

    df.to_excel(output_path, index=False, engine="openpyxl")

    print(f"\nExtraction complete. Results saved to: {output_path}")
    print(f"Total rows written: {len(df)}\n")
    print("Preview (first 5 rows):")
    print(df.head(5).to_string(index=False))
    print()


# ==============================================================================
# 6. Verification Block
# ==============================================================================

if __name__ == "__main__":

    # ------------------------------------------------------------------
    # Mock test — single document verification
    # ------------------------------------------------------------------
    print("=" * 62)
    print("  YAKE Keyword Extractor — Local Verification Test")
    print("=" * 62)

    test_title: str = (
        "Optimization of CO2 Storage and Conversion using Chemkin Pro"
    )
    test_abstract: str = (
        "This study explores the reaction dynamics of carbon dioxide with "
        "transition metals to produce high-yield metal oxides and carbon "
        "monoxide. By utilizing Ansys and Chemkin Pro, we modeled the "
        "thermodynamic efficiencies of the storage mechanisms and evaluated "
        "the conversion rates under industrial parameters."
    )

    result: list[str] = extract_academic_keywords(
        test_title, test_abstract, top_n=3
    )

    print(f"\nInput Title   : {test_title}")
    print(f"Input Abstract: {test_abstract[:88]}...")
    print("\nExtracted Keywords (Top 3):")
    for i, kw in enumerate(result, start=1):
        print(f"  [{i}]  {kw}")

    # ------------------------------------------------------------------
    # Batch run — top 100 papers from MongoDB
    # ------------------------------------------------------------------
    print("\n" + "=" * 62)
    print("  Batch Mode — Top 100 Papers from MongoDB")
    print("=" * 62)

    run_batch_extraction()
