/**
 * Backfill abstracts for Scholar papers that Semantic Scholar / CrossRef
 * couldn't fill — using SerpAPI's Google Scholar search which returns the
 * exact description/snippet Google Scholar shows for every paper.
 *
 * Uses 1 SerpAPI credit per paper. Only runs on papers still missing abstract.
 *
 * Usage:
 *   node scripts/backfill-scholar-abstracts-serpapi.mjs             # all missing
 *   node scripts/backfill-scholar-abstracts-serpapi.mjs --limit 20  # first N only
 *   node scripts/backfill-scholar-abstracts-serpapi.mjs --dry-run   # preview only
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
if (!MONGO_URI) {
  throw new Error("MONGO_URI environment variable is required");
}
const SERPAPI_KEY = process.env.SERPAPI_KEY || "";
const DELAY_MS    = 1200; // ~1 req/sec — SerpAPI's recommended rate

const args     = process.argv.slice(2);
const DRY_RUN  = args.includes("--dry-run");
const limitArg = args.indexOf("--limit");
const LIMIT    = limitArg !== -1 ? Number(args[limitArg + 1]) : null;

if (!SERPAPI_KEY) {
    console.error("ERROR: SERPAPI_KEY not set in .env");
    process.exit(1);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function titleMatches(queryTitle, candidateTitle) {
    const a = queryTitle.toLowerCase().trim();
    const b = candidateTitle.toLowerCase().trim();
    const words = a.split(/\s+/).filter((w) => w.length > 3);
    if (!words.length) return true;
    return words.filter((w) => b.includes(w)).length / words.length >= 0.55;
}

/**
 * Search Google Scholar via SerpAPI and extract:
 *   - snippet  → the description/abstract Google Scholar shows
 *   - link     → the paper's URL
 */
async function fetchFromSerpApi(title) {
    const params = new URLSearchParams({
        engine:  "google_scholar",
        q:       title,
        api_key: SERPAPI_KEY,
        num:     "3",
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
        // Monthly quota exhausted → no point continuing the whole run.
        if (resp.status === 429 && /run out of searches/i.test(body)) {
            return { fatal: true, error: "SerpAPI monthly quota exhausted (250/month). Resume next month or upgrade the plan." };
        }
        return { error: `HTTP ${resp.status}: ${body.slice(0, 200)}` };
    }

    let data;
    try { data = await resp.json(); } catch { return { error: "JSON parse failed" }; }

    const results = data?.organic_results || [];
    for (const r of results) {
        const candidate = r.title || "";
        if (!titleMatches(title, candidate)) continue;

        const snippet = (r.snippet || "").trim();
        const link    = r.link || r.resources?.[0]?.link || "";
        if (snippet.length > 10 || link) {
            return { snippet, link };
        }
    }

    // If no title match found, still use the top result's snippet as last resort
    if (results.length > 0 && results[0].snippet?.length > 10) {
        return { snippet: results[0].snippet, link: results[0].link || "", loose: true };
    }

    return { error: "not found" };
}

// ── Main ─────────────────────────────────────────────────────────────────────

await mongoose.connect(MONGO_URI);
console.log(`MongoDB connected → ${mongoose.connection.db.databaseName}`);
if (DRY_RUN) console.log("DRY-RUN mode — nothing will be written.");
console.log(`SerpAPI key: ${SERPAPI_KEY.slice(0, 8)}...****\n`);

const col = mongoose.connection.db.collection("researchmetadatascopus");

// Only Scholar papers with still-empty abstract
let docs = await col
    .find(
        {
            document_eid: { $regex: "^scholar_" },
            $or: [
                { abstract: "" },
                { abstract: { $exists: false } },
            ],
        },
        { projection: { title: 1, publication_year: 1, abstract: 1, link: 1 } }
    )
    .toArray();

if (LIMIT) docs = docs.slice(0, LIMIT);

console.log(`Found ${docs.length} Scholar papers still missing abstract.`);
console.log(`Estimated SerpAPI credits needed: ${docs.length}\n`);

let updated = 0;
let notFound = 0;
let errors = 0;

for (let i = 0; i < docs.length; i++) {
    const doc   = docs[i];
    const title = doc.title || "";

    process.stdout.write(`[${i + 1}/${docs.length}] ${title.slice(0, 60)}... `);

    const result = await fetchFromSerpApi(title);

    if (result.fatal) {
        console.log(`\n\n⛔ ${result.error}`);
        console.log(`Stopped at paper ${i + 1}/${docs.length}. Already-filled abstracts are saved.`);
        break;
    }

    if (result.error) {
        console.log(`→ ${result.error}`);
        notFound++;
    } else {
        const { snippet, link, loose } = result;
        const preview = snippet.slice(0, 80) + "...";
        console.log(`${loose ? "[loose match] " : ""}→ "${preview}"`);
        if (link) console.log(`   link: ${link}`);

        if (!DRY_RUN) {
            const setFields = {};
            if (snippet.length > 10) setFields.abstract = snippet;
            if (link && !doc.link)   setFields.link     = link;

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

    if (i < docs.length - 1) await sleep(DELAY_MS);
}

console.log("\n══════════════════════════════════════");
console.log(" SerpAPI abstract backfill complete");
console.log(`  Processed : ${docs.length}`);
console.log(`  Updated   : ${updated}`);
console.log(`  Not found : ${notFound}`);
console.log(`  Errors    : ${errors}`);
console.log("══════════════════════════════════════");

await mongoose.disconnect();
