/**
 * Backfill abstract + link for Google Scholar papers.
 *
 * Strategy (in priority order):
 *  1. DOI direct lookup on Semantic Scholar  — exact match, highest accuracy
 *     (uses the DOI already stored in the `link` field if present)
 *  2. Title search on Semantic Scholar       — fallback when no DOI stored
 *  3. CrossRef title search                  — for URL/DOI when S2 misses
 *
 * FREE — CrossRef has no auth/quota. Semantic Scholar free key is generous.
 *
 * Only updates empty fields — safe to re-run.
 *
 * Usage:
 *   node scripts/backfill-scholar-abstracts.mjs             # all missing
 *   node scripts/backfill-scholar-abstracts.mjs --limit 50  # first 50 only
 *   node scripts/backfill-scholar-abstracts.mjs --dry-run   # preview only
 */

import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config({
    path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env"),
});

// ── Config ───────────────────────────────────────────────────────────────────

const MONGODB_URI  = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  throw new Error("MONGODB_URI environment variable is required");
}
const S2_API_KEY = process.env.SEMANTIC_SCHOLAR_KEY || "";
const CR_MAILTO  = process.env.CR_MAILTO || "research@iitd.ac.in";
const DELAY_MS   = S2_API_KEY ? 500 : 2000;

const args     = process.argv.slice(2);
const DRY_RUN  = args.includes("--dry-run");
const limitArg = args.indexOf("--limit");
const LIMIT    = limitArg !== -1 ? Number(args[limitArg + 1]) : null;

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/** Extract DOI from a DOI URL like https://doi.org/10.xxxx/yyyy */
function extractDoi(link) {
    if (!link) return null;
    const m = link.match(/doi\.org\/(.+)/i);
    return m ? m[1].trim() : null;
}

/** Title match — 60%+ of meaningful words must overlap. */
function titleMatches(queryTitle, candidateTitle) {
    const a = queryTitle.toLowerCase().trim();
    const b = candidateTitle.toLowerCase().trim();
    const words = a.split(/\s+/).filter((w) => w.length > 3);
    if (!words.length) return true;
    return words.filter((w) => b.includes(w)).length / words.length >= 0.6;
}

/** Fetch with 429 retry + exponential backoff. */
async function fetchWithRetry(url, headers = {}) {
    let resp;
    for (let attempt = 0; attempt < 4; attempt++) {
        try {
            resp = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
        } catch (err) {
            return { ok: false, status: 0, _err: err.message };
        }
        if (resp.status === 429) {
            const wait = 5000 * (attempt + 1);
            process.stdout.write(` [429→${wait / 1000}s]`);
            await sleep(wait);
            continue;
        }
        break;
    }
    return resp || { ok: false, status: 0 };
}

/** Parse an S2 paper object into { abstract, url } */
function parseS2Paper(paper) {
    if (!paper) return null;
    const abstract = (paper.abstract || "").trim();
    const url =
        paper.openAccessPdf?.url ||
        paper.url ||
        (paper.externalIds?.DOI ? `https://doi.org/${paper.externalIds.DOI}` : "");
    return { abstract, url };
}

/**
 * S2 lookup by DOI — exact, always correct when we already have the DOI.
 */
async function fetchS2ByDoi(doi) {
    const headers = { "Accept": "application/json" };
    if (S2_API_KEY) headers["x-api-key"] = S2_API_KEY;

    const url = `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(doi)}?fields=title,abstract,url,openAccessPdf,externalIds`;
    const resp = await fetchWithRetry(url, headers);
    if (!resp.ok) return null;

    let data;
    try { data = await resp.json(); } catch { return null; }
    return parseS2Paper(data);
}

/**
 * S2 title search — used when no DOI is stored yet.
 */
async function fetchS2ByTitle(title, year) {
    const headers = { "Accept": "application/json" };
    if (S2_API_KEY) headers["x-api-key"] = S2_API_KEY;

    const query = year ? `${title} ${year}` : title;
    const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&fields=title,abstract,url,openAccessPdf,externalIds&limit=3`;

    const resp = await fetchWithRetry(url, headers);
    if (!resp.ok) return null;

    let data;
    try { data = await resp.json(); } catch { return null; }

    for (const paper of (data?.data || [])) {
        if (!titleMatches(title, paper.title || "")) continue;
        const parsed = parseS2Paper(paper);
        if (parsed.abstract.length > 10 || parsed.url) return parsed;
    }
    return null;
}

/**
 * CrossRef title search — used as a last resort to get a DOI/URL when S2
 * also doesn't know the paper. CrossRef rarely has full abstracts for physics/
 * CS papers, so we use it mainly for the URL.
 */
async function fetchCrossRef(title, year) {
    const q = encodeURIComponent(title);
    const url = `https://api.crossref.org/works?query.title=${q}&rows=3&sort=relevance&mailto=${CR_MAILTO}`;
    const resp = await fetchWithRetry(url, { "Accept": "application/json" });
    if (!resp.ok) return null;

    let data;
    try { data = await resp.json(); } catch { return null; }

    for (const item of (data?.message?.items || [])) {
        if (!titleMatches(title, item.title?.[0] || "")) continue;
        const abstract = (item.abstract || "")
            .replace(/<\/?[^>]+(>|$)/g, "")
            .trim();
        const doi = item.DOI;
        const paperUrl = item.URL || (doi ? `https://doi.org/${doi}` : "");
        if (abstract.length > 10 || paperUrl) return { abstract, url: paperUrl };
    }
    return null;
}

/**
 * Main resolution logic:
 *  1. If we already have a DOI link → hit S2 directly by DOI (exact abstract)
 *  2. S2 title search
 *  3. CrossRef title search (URL only most of the time)
 *
 *  After step 3, if we got a DOI but no abstract, try S2 by that DOI too.
 */
async function resolveAbstractAndLink(doc) {
    const title     = doc.title || "";
    const year      = doc.publication_year || null;
    const storedDoi = extractDoi(doc.link);

    // ── Step 1: DOI direct lookup on S2 ──────────────────────────────────────
    if (storedDoi) {
        process.stdout.write(" [DOI→S2]");
        const result = await fetchS2ByDoi(storedDoi);
        if (result && result.abstract.length > 10) {
            return { ...result, source: "s2-doi" };
        }
        // DOI found in S2 but no abstract there — still keep URL from result
        if (result && result.url) {
            // Try title search as extra attempt for abstract
            const s2t = await fetchS2ByTitle(title, year);
            if (s2t && s2t.abstract.length > 10) {
                return { abstract: s2t.abstract, url: result.url || s2t.url, source: "s2-doi+title" };
            }
            return { ...result, source: "s2-doi-no-abstract" };
        }
    }

    // ── Step 2: S2 title search ───────────────────────────────────────────────
    process.stdout.write(" [S2-title]");
    const s2 = await fetchS2ByTitle(title, year);
    if (s2 && (s2.abstract.length > 10 || s2.url)) {
        return { ...s2, source: "s2-title" };
    }

    // ── Step 3: CrossRef title search ─────────────────────────────────────────
    process.stdout.write(" [CR]");
    const cr = await fetchCrossRef(title, year);
    if (!cr) return null;

    // If CrossRef gave us a DOI but no abstract, do one more S2 DOI lookup
    const crDoi = extractDoi(cr.url);
    if (crDoi && cr.abstract.length <= 10) {
        process.stdout.write(" [DOI→S2 retry]");
        const s2doi = await fetchS2ByDoi(crDoi);
        if (s2doi && s2doi.abstract.length > 10) {
            return { abstract: s2doi.abstract, url: cr.url || s2doi.url, source: "cr+s2-doi" };
        }
    }

    return cr.abstract.length > 10 || cr.url ? { ...cr, source: "crossref" } : null;
}

// ── Main ─────────────────────────────────────────────────────────────────────

await mongoose.connect(MONGODB_URI);
console.log(`MongoDB connected → ${mongoose.connection.db.databaseName}`);
if (DRY_RUN) console.log("DRY-RUN mode — nothing will be written.\n");
console.log(`Semantic Scholar API key: ${S2_API_KEY ? "YES ✓" : "NO (rate limit applies)"}\n`);

const col = mongoose.connection.db.collection("researchmetadatascopus");

// Find Scholar papers missing abstract (regardless of whether link is set)
const query = {
    document_eid: { $regex: "^scholar_" },
    $or: [
        { abstract: "" },
        { abstract: { $exists: false } },
        { link: "" },
        { link: { $exists: false } },
    ],
};

let docs = await col
    .find(query, { projection: { title: 1, publication_year: 1, abstract: 1, link: 1 } })
    .toArray();

if (LIMIT) docs = docs.slice(0, LIMIT);

console.log(`Found ${docs.length} Scholar papers with missing abstract/link.\n`);

let updated = 0;
let noMatch = 0;
let errors  = 0;

for (let i = 0; i < docs.length; i++) {
    const doc   = docs[i];
    const title = doc.title || "";

    process.stdout.write(`[${i + 1}/${docs.length}] ${title.slice(0, 55)}...`);

    const result = await resolveAbstractAndLink(doc);

    if (!result) {
        console.log(" → not found");
        noMatch++;
    } else {
        const { abstract = "", url = "", source } = result;
        const hasAbstract = abstract.length > 10;
        const hasUrl      = url.length > 0;

        if (!hasAbstract && !hasUrl) {
            console.log(` → [${source}] no abstract/link`);
            noMatch++;
        } else {
            const preview = hasAbstract ? abstract.slice(0, 70) + "..." : "(no abstract)";
            console.log(`\n   [${source}] "${preview}"`);
            if (hasUrl) console.log(`   link: ${url}`);

            if (!DRY_RUN) {
                const setFields = {};
                if (hasAbstract && !doc.abstract) setFields.abstract = abstract;
                if (hasUrl      && !doc.link)     setFields.link     = url;

                if (Object.keys(setFields).length > 0) {
                    try {
                        await col.updateOne({ _id: doc._id }, { $set: setFields });
                        updated++;
                    } catch (err) {
                        console.error(`   [update error] ${err.message}`);
                        errors++;
                    }
                } else {
                    console.log("   (nothing new to write)");
                }
            } else {
                updated++;
            }
        }
    }

    if (i < docs.length - 1) await sleep(DELAY_MS);
}

console.log("\n══════════════════════════════════════");
console.log(" Abstract backfill complete");
console.log(`  Processed : ${docs.length}`);
console.log(`  Updated   : ${updated}`);
console.log(`  Not found : ${noMatch}`);
console.log(`  Errors    : ${errors}`);
console.log("══════════════════════════════════════");

await mongoose.disconnect();
