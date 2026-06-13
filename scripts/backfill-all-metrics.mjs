/**
 * Unified h_index + citation_count backfill for ALL faculty.
 *
 * Strategy (in priority order per faculty):
 *  1. Has google_scholar_id → SerpAPI (live, accurate, covers Scopus+Scholar faculty)
 *  2. Has scopus_id + papers already in DB → calculate from stored citation counts
 *  3. Otherwise → skip (no data source available)
 *
 * Only updates Faculty docs where h_index = 0 (never overwrites real data).
 * Safe to re-run.
 *
 * Usage:
 *   node scripts/backfill-all-metrics.mjs             # all with h_index = 0
 *   node scripts/backfill-all-metrics.mjs --all       # force-update everyone
 *   node scripts/backfill-all-metrics.mjs --dry-run
 *   node scripts/backfill-all-metrics.mjs --limit 20
 */

import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config({
    path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env"),
});

// ── Config ───────────────────────────────────────────────────────────────────

const MONGO_URI   = process.env.MONGO_URI;
const SERPAPI_KEY = process.env.SERPAPI_KEY || "";
const DELAY_MS    = 1300; // ~1 req/sec for SerpAPI

const args     = process.argv.slice(2);
const DRY_RUN  = args.includes("--dry-run");
const FORCE    = args.includes("--all");  // update even if h_index > 0
const limitArg = args.indexOf("--limit");
const LIMIT    = limitArg !== -1 ? Number(args[limitArg + 1]) : 0;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ── h-index calculator ───────────────────────────────────────────────────────

/**
 * Calculate h-index from an array of citation counts.
 * h-index = largest n where n papers have ≥ n citations.
 */
function calcHIndex(citationCounts) {
    const sorted = [...citationCounts].sort((a, b) => b - a);
    let h = 0;
    for (let i = 0; i < sorted.length; i++) {
        if (sorted[i] >= i + 1) h = i + 1;
        else break;
    }
    return h;
}

// ── SerpAPI fetch ────────────────────────────────────────────────────────────

async function fetchScholarMetrics(scholarId) {
    // Strip trailing &hl=... or similar query cruft stored in some IDs
    const cleanId = scholarId.split("&")[0].trim();
    if (!cleanId) return null;

    const params = new URLSearchParams({
        engine:  "google_scholar_author",
        author_id: cleanId,
        api_key: SERPAPI_KEY,
    });

    let resp;
    try {
        resp = await fetch(`https://serpapi.com/search.json?${params}`, {
            signal: AbortSignal.timeout(20000),
        });
    } catch (err) {
        return { error: err.message };
    }

    if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        return { error: `HTTP ${resp.status}: ${body.slice(0, 150)}` };
    }

    let data;
    try { data = await resp.json(); } catch { return { error: "JSON parse failed" }; }

    const cited = data?.cited_by?.table;
    if (!cited) return { error: "no cited_by table" };

    const hIndex       = cited.find(r => r.h_index)?.h_index?.all ?? 0;
    const citationCount = cited.find(r => r.citations)?.citations?.all ?? 0;
    return { hIndex: Number(hIndex), citationCount: Number(citationCount) };
}

// ── Main ─────────────────────────────────────────────────────────────────────

await mongoose.connect(MONGO_URI);
console.log(`MongoDB connected → ${mongoose.connection.db.databaseName}`);
if (DRY_RUN) console.log("DRY-RUN — nothing will be written.");
if (!SERPAPI_KEY) console.warn("WARNING: SERPAPI_KEY not set — Scholar fetch will fail.");
console.log();

const facCol = mongoose.connection.db.collection("faculties");
const resCol = mongoose.connection.db.collection("researchmetadatascopus");

// Find faculty to process
const filter = FORCE ? {} : {
    $or: [
        { h_index: 0 },
        { h_index: { $exists: false } },
        { citation_count: 0 },
        { citation_count: { $exists: false } },
    ],
};

let docs = await facCol.find(filter).toArray();
if (LIMIT > 0) docs = docs.slice(0, LIMIT);

console.log(`Processing ${docs.length} faculty${FORCE ? " (all)" : " with h_index = 0"}.\n`);

let serpUpdated = 0;
let scopusUpdated = 0;
let skipped = 0;
let failed = 0;
let serpCalls = 0;

for (let i = 0; i < docs.length; i++) {
    const f = docs[i];
    const name      = `${f.title || ""} ${f.firstName || ""} ${f.lastName || ""}`.trim();
    const scholarId = (f.google_scholar_id || []).find(id => typeof id === "string" && id.trim())?.split("&")[0];
    const scopusId  = (f.scopus_id || []).find(id => typeof id === "string" && id.trim());

    process.stdout.write(`[${i + 1}/${docs.length}] ${name} `);

    // ── Strategy 1: Scholar ID → SerpAPI ─────────────────────────────────────
    if (scholarId) {
        process.stdout.write(`[Scholar→SerpAPI] `);
        serpCalls++;
        const metrics = await fetchScholarMetrics(scholarId);

        if (metrics.error) {
            console.log(`→ ERROR: ${metrics.error}`);
            failed++;
        } else {
            console.log(`→ h=${metrics.hIndex}, c=${metrics.citationCount}`);
            if (!DRY_RUN) {
                await facCol.updateOne(
                    { _id: f._id },
                    { $set: { h_index: metrics.hIndex, citation_count: metrics.citationCount } }
                );
                serpUpdated++;
            } else {
                serpUpdated++;
            }
        }

        if (i < docs.length - 1) await sleep(DELAY_MS);
        continue;
    }

    // ── Strategy 2: Scopus only → derive from stored papers ──────────────────
    if (scopusId) {
        const papers = await resCol
            .find({ "authors.author_id": scopusId }, { projection: { citation_count: 1 } })
            .toArray();

        if (papers.length === 0) {
            console.log(`[Scopus-only] → 0 papers in DB, skip`);
            skipped++;
        } else {
            const counts = papers.map(p => p.citation_count ?? 0);
            const hIndex        = calcHIndex(counts);
            const citationCount = counts.reduce((s, c) => s + c, 0);
            console.log(`[Scopus-derived] ${papers.length} papers → h=${hIndex}, c=${citationCount}`);
            if (!DRY_RUN) {
                await facCol.updateOne(
                    { _id: f._id },
                    { $set: { h_index: hIndex, citation_count: citationCount } }
                );
                scopusUpdated++;
            } else {
                scopusUpdated++;
            }
        }
        continue;
    }

    // ── No data source ────────────────────────────────────────────────────────
    console.log(`→ no Scholar or Scopus ID, skip`);
    skipped++;
}

console.log("\n══════════════════════════════════════════════");
console.log(" Metrics backfill complete");
console.log(`  Updated via Scholar (SerpAPI) : ${serpUpdated}   (${serpCalls} API calls)`);
console.log(`  Updated via Scopus (from DB)  : ${scopusUpdated}`);
console.log(`  Skipped (no data)             : ${skipped}`);
console.log(`  Failed                        : ${failed}`);
console.log("══════════════════════════════════════════════");

await mongoose.disconnect();
