/**
 * Google Scholar fallback service.
 *
 * Faculty whose `scopus_id` array is empty cannot be served by the Scopus
 * pipeline (papers live in `ResearchMetaDataScopus`, keyed by Scopus author
 * id). For those faculty we fall back to Google Scholar using
 * `google_scholar_id[0]`.
 *
 * The heavy lifting (scraping Scholar) is done by a small Python helper
 * (`src/python/fetch_scholar.py`) using the `scholarly` package. This module:
 *   1. spawns that script and parses its JSON,
 *   2. caches results in-memory with a TTL (Scholar is slow + rate limited),
 *   3. maps the normalized payload into the SAME shape the Scopus path returns
 *      (`coworkersFromPapers` + `stats`) so the frontend renders identically.
 *
 * Every failure mode (no python, missing package, blocked request, timeout,
 * bad JSON) resolves to `null` so the caller can degrade gracefully instead of
 * throwing — the UI must never break because Scholar was unavailable.
 */

import { spawn } from "child_process";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.resolve(__dirname, "../python/fetch_scholar.py");

const PYTHON_BIN = process.env.PYTHON_BIN || "python";
const TIMEOUT_MS = Number(process.env.SCHOLAR_TIMEOUT_MS) || 45000;
const CACHE_TTL_MS = Number(process.env.SCHOLAR_CACHE_TTL_MS) || 6 * 60 * 60 * 1000;

// scholarId -> { expiresAt: number, data: object|null }
const cache = new Map();

const pickPrimaryIdentifier = (value) => {
    if (Array.isArray(value)) {
        return value.find((item) => typeof item === "string" && item.trim().length > 0)?.trim();
    }
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
};

const facultyDisplayName = (faculty) =>
    [faculty?.title, faculty?.firstName, faculty?.lastName]
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

/**
 * Spawn the Python helper and resolve its parsed JSON, or `null` on any error.
 * @param {string} scholarId
 * @returns {Promise<object|null>}
 */
const runScholarScript = (scholarId) =>
    new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(value);
        };

        let child;
        try {
            child = spawn(PYTHON_BIN, [SCRIPT_PATH, scholarId], { windowsHide: true });
        } catch (err) {
            console.error(`[scholar] failed to spawn "${PYTHON_BIN}": ${err.message}`);
            return resolve(null);
        }

        const timer = setTimeout(() => {
            try {
                child.kill();
            } catch {
                /* ignore */
            }
            console.error(`[scholar] timed out after ${TIMEOUT_MS}ms for id ${scholarId}`);
            finish(null);
        }, TIMEOUT_MS);

        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
        });

        child.on("error", (err) => {
            console.error(`[scholar] process error for id ${scholarId}: ${err.message}`);
            finish(null);
        });

        child.on("close", (code) => {
            if (code !== 0) {
                console.error(
                    `[scholar] helper exited with code ${code} for id ${scholarId}: ${stderr.trim()}`
                );
                return finish(null);
            }
            try {
                finish(JSON.parse(stdout));
            } catch (err) {
                console.error(`[scholar] could not parse helper output for id ${scholarId}: ${err.message}`);
                finish(null);
            }
        });
    });

/**
 * Fetch normalized Scholar analytics for an author id, with in-memory caching.
 * @param {string} scholarId
 * @returns {Promise<object|null>}
 */
export async function fetchScholarData(scholarId) {
    const id = typeof scholarId === "string" ? scholarId.trim() : "";
    if (!id) return null;

    const cached = cache.get(id);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.data;
    }

    const data = await runScholarScript(id);
    // Cache both hits and misses so a blocked/slow author isn't retried on
    // every page load. Misses use a shorter TTL so transient blocks recover.
    cache.set(id, {
        data,
        expiresAt: Date.now() + (data ? CACHE_TTL_MS : Math.min(CACHE_TTL_MS, 10 * 60 * 1000)),
    });
    return data;
}

/**
 * Map a normalized Scholar payload onto `coworkersFromPapers` + stats so the
 * existing FacultyProfile UI (co-authors card + publication timeline) renders
 * unchanged.
 *
 * The frontend derives the timeline from entries that have a
 * `publication_year`, and the co-authors card from `coworkersFromPapers[].name`.
 * We therefore emit:
 *   - one entry per (paper × author) when per-paper authors are available
 *     (mirrors the Scopus path: timeline gets "with <authors>", card gets names)
 *   - otherwise paper entries carry the venue as the "with" hint, and the real
 *     author-level co-authors are prepended WITHOUT a year (so they populate the
 *     co-authors card but are skipped by the timeline).
 */
const buildCoworkersFromScholar = (scholar, ownName) => {
    const papers = Array.isArray(scholar.papers) ? scholar.papers : [];
    const coAuthors = Array.isArray(scholar.coAuthors) ? scholar.coAuthors : [];

    const ownLower = (ownName || "").toLowerCase();
    const entries = [];
    const uniqueCoauthors = new Set();
    let sawPerPaperAuthors = false;

    for (const paper of papers) {
        const authors = (Array.isArray(paper.authors) ? paper.authors : []).filter(
            (n) => typeof n === "string" && n.trim() && n.trim().toLowerCase() !== ownLower
        );

        const base = {
            title: paper.title || "",
            publication_year: paper.year || null,
            document_type: paper.type || "Publication",
            subject_area: [],
            affiliation: paper.venue || "",
            author_id: "",
            matched_profile: null,
            // Google Scholar paper URL — frontend uses this to make paper titles clickable.
            link: paper.url || null,
            document_scopus_id: null,
        };

        if (authors.length > 0) {
            sawPerPaperAuthors = true;
            authors.forEach((name) => {
                uniqueCoauthors.add(name.trim());
                entries.push({ ...base, name: name.trim() });
            });
        } else {
            // No per-paper authors: still surface the paper in the timeline.
            // Use the venue as the "with" hint so the line is informative.
            entries.push({ ...base, name: paper.venue || "" });
        }
    }

    // When we have no per-paper authors at all, populate the co-authors card
    // from the author-level co-author list (no year => excluded from timeline).
    if (!sawPerPaperAuthors && coAuthors.length > 0) {
        const coAuthorEntries = coAuthors.map((co) => {
            uniqueCoauthors.add((co.name || "").trim());
            return {
                title: "",
                publication_year: null,
                document_type: "",
                subject_area: [],
                name: (co.name || "").trim(),
                affiliation: co.affiliation || "",
                author_id: co.scholarId || "",
                matched_profile: null,
                link: null,
                document_scopus_id: null,
            };
        });
        entries.unshift(...coAuthorEntries);
    }

    // Keep named entries (real co-authors / venue-tagged papers) ahead of any
    // nameless paper entries so the co-authors card — which renders the first
    // few entries — never leads with blank chips. The timeline is unaffected
    // because it keys off `publication_year`, not order.
    const named = entries.filter((e) => e.name && e.name.trim().length > 0);
    const unnamed = entries.filter((e) => !e.name || e.name.trim().length === 0);

    return {
        coworkersFromPapers: [...named, ...unnamed],
        totalPapers: papers.length,
        uniqueCoauthors: uniqueCoauthors.size,
    };
};

/**
 * Stable EID from a Scholar paper title + year.
 * Prefix "scholar_" ensures no collision with real Scopus EIDs ("2-s2.0-...").
 */
function makeScholarEid(title, year) {
    return (
        "scholar_" +
        crypto
            .createHash("md5")
            .update(`${(title || "").toLowerCase().trim()}_${year ?? ""}`)
            .digest("hex")
            .slice(0, 16)
    );
}

/**
 * Derive the kerberos ID from a faculty email address.
 * e.g. "kkdeepak@cbme.iitd.ac.in" → "kkdeepak"
 * Falls back to an empty string if email is not set.
 */
const kerberosFromEmail = (email) =>
    typeof email === "string" && email.includes("@")
        ? email.split("@")[0].toLowerCase()
        : "";

/**
 * Persist Google Scholar papers to `researchmetadatascopus` so they share the
 * same collection as Scopus papers and are picked up by the OpenSearch indexer.
 *
 * Design decisions:
 *  - `document_eid`  = "scholar_<md5(title+year)>" — stable, collision-free
 *  - `document_scopus_id` = same value (schema requires it; Scholar has no EID)
 *  - `kerberos`      = email prefix of the faculty (e.g. "kkdeepak")
 *                      same format as Scopus papers — enables author-filtered search
 *  - `open_search_id` = "pending_<eid>" — indexer watches for this prefix
 *  - `abstract` defaults to "" (required by schema; Scholar rarely exposes it)
 *  - `author_id` defaults to "" (required by AuthorSchema; no Scopus IDs)
 *  - Core fields use `$setOnInsert` (never overwrite); `kerberos` uses `$set`
 *    so re-running the backfill correctly stamps previously-inserted papers.
 *
 * @param {object} faculty   - lean Faculty document (needs .email field)
 * @param {Array}  papers    - normalized papers from the Scholar helper
 */
async function persistScholarPapers(faculty, papers) {
    if (!Array.isArray(papers) || papers.length === 0) return;

    let ResearchDoc;
    try {
        ResearchDoc = mongoose.model("ResearchMetaDataScopus");
    } catch {
        return;
    }

    const kerberos = kerberosFromEmail(faculty?.email);

    const ops = papers
        .filter((p) => p?.title?.trim())
        .map((paper) => {
            const eid = makeScholarEid(paper.title, paper.year);

            const authorList = (Array.isArray(paper.authors) ? paper.authors : []).map(
                (name, idx, arr) => ({
                    author_id: "",
                    author_name: typeof name === "string" ? name.trim() : String(name),
                    author_position:
                        idx === 0 ? "first" : idx === arr.length - 1 ? "last" : "middle",
                })
            );

            return {
                updateOne: {
                    filter: { document_eid: eid },
                    update: {
                        // stamp kerberos on every run (fixes papers inserted before this change)
                        $set: { kerberos },
                        $setOnInsert: {
                            document_eid:       eid,
                            document_scopus_id: eid,
                            title:              paper.title.trim(),
                            abstract:           paper.abstract || "",
                            authors:            authorList,
                            citation_count:     Number.isFinite(paper.citations) ? paper.citations : 0,
                            publication_year:   paper.year ? Number(paper.year) : null,
                            document_type:      paper.type || "Publication",
                            field_associated:   "",
                            subject_area:       [],
                            link:               paper.url || "",
                            open_search_id:     `pending_${eid}`,
                        },
                    },
                    upsert: true,
                },
            };
        });

    if (ops.length === 0) return;

    try {
        const result = await ResearchDoc.bulkWrite(ops, { ordered: false });
        const inserted = result.upsertedCount ?? 0;
        if (inserted > 0) {
            console.log(`[scholar] persisted ${inserted} new paper(s) for ${kerberos || faculty?._id}`);
        }
    } catch (err) {
        console.error(`[scholar] failed to persist papers for ${faculty?._id}: ${err.message}`);
    }
}

/**
 * Load a faculty's Scholar papers directly from MongoDB using their kerberos
 * (email prefix). Returns null if no papers stored yet — caller falls back to API.
 *
 * @param {object} faculty - lean Faculty document (needs .email field)
 * @returns {Promise<object[]|null>}
 */
async function loadPapersFromDB(faculty) {
    const kerberos = kerberosFromEmail(faculty?.email);
    if (!kerberos) return null;

    let ResearchDoc;
    try {
        ResearchDoc = mongoose.model("ResearchMetaDataScopus");
    } catch {
        return null;
    }

    const docs = await ResearchDoc.find(
        { kerberos, document_eid: /^scholar_/ },   // only Scholar papers for this faculty
        { title: 1, abstract: 1, authors: 1, citation_count: 1, publication_year: 1,
          document_type: 1, link: 1 }
    ).lean();

    if (!docs.length) return null;

    // Normalize to the same shape the Python helper returns so downstream code
    // (buildCoworkersFromScholar, timeline, co-authors card) works identically.
    return docs.map((d) => ({
        title:     d.title || "",
        year:      d.publication_year || null,
        authors:   (d.authors || []).map((a) => a.author_name).filter(Boolean),
        venue:     "",
        type:      d.document_type || "Publication",
        url:       d.link || "",
        citations: d.citation_count || 0,
        abstract:  d.abstract || "",
    }));
}

/**
 * High-level helper used by the directory controller.
 *
 * Resolves a faculty's Google Scholar analytics and returns a research block in
 * the same shape the Scopus path produces, or `null` when no Scholar id is set
 * or the fetch failed (caller then degrades gracefully).
 *
 * Also persists the fetched papers to `researchmetadatascopus` (fire-and-forget)
 * so they are available for OpenSearch indexing and appear alongside Scopus papers.
 *
 * @param {object} faculty - lean Faculty document
 * @returns {Promise<null | {
 *   source: 'scholar',
 *   scopusId: undefined,
 *   hIndex: number,
 *   citationCount: number,
 *   coworkersFromPapers: object[],
 *   stats: { totalPapers: number, uniqueCoauthors: number },
 *   papers: object[],
 *   coAuthors: object[],
 *   publicationTimeline: object[]
 * }>}
 */
export async function getScholarResearchBlock(faculty) {
    const scholarId = pickPrimaryIdentifier(faculty?.google_scholar_id);
    if (!scholarId) return null;

    // ── 1. Try DB first (fast, no API quota) ────────────────────────────────
    const dbPapers = await loadPapersFromDB(faculty).catch(() => null);

    let papers, hIndex, citationCount, coAuthors, publicationTimeline;

    if (dbPapers && dbPapers.length > 0) {
        // Papers already stored — build response from DB, no API call needed.
        console.log(`[scholar] serving ${dbPapers.length} paper(s) from DB for ${kerberosFromEmail(faculty?.email) || scholarId}`);
        papers           = dbPapers;
        // h_index and citation_count come from the Faculty document (updated on
        // first visit / backfill); fall back to 0 only if not set yet.
        hIndex           = Number.isFinite(faculty?.h_index) ? faculty.h_index : 0;
        citationCount    = Number.isFinite(faculty?.citation_count) ? faculty.citation_count : 0;
        coAuthors        = [];
        publicationTimeline = [];
    } else {
        // ── 2. No papers in DB → call Scholar API and persist results ─────
        const scholar = await fetchScholarData(scholarId);
        if (!scholar) return null;

        papers           = Array.isArray(scholar.papers) ? scholar.papers : [];
        hIndex           = Number.isFinite(scholar.hIndex) ? scholar.hIndex : 0;
        citationCount    = Number.isFinite(scholar.citations) ? scholar.citations : 0;
        coAuthors        = Array.isArray(scholar.coAuthors) ? scholar.coAuthors : [];
        publicationTimeline = Array.isArray(scholar.publicationTimeline)
            ? scholar.publicationTimeline : [];

        // Persist to DB so future visits are served from DB.
        persistScholarPapers(faculty, papers).catch((err) =>
            console.error(`[scholar] persistScholarPapers threw: ${err.message}`)
        );
    }

    const { coworkersFromPapers, totalPapers, uniqueCoauthors } = buildCoworkersFromScholar(
        { papers, coAuthors },
        facultyDisplayName(faculty)
    );

    return {
        source: "scholar",
        scopusId: undefined,
        hIndex,
        citationCount,
        coworkersFromPapers,
        stats: { totalPapers, uniqueCoauthors },
        papers,
        coAuthors,
        publicationTimeline,
    };
}
