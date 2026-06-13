/**
 * One-time backfill: populate h_index / citation_count for faculty who have NO
 * Scopus id but DO have a Google Scholar id, so directory listing cards show
 * real metrics without needing each profile to be opened first.
 *
 * The live detail endpoint already write-backs these metrics when a profile is
 * viewed; this script just does the whole batch up front.
 *
 * Usage (from research-ambit-main/):
 *   node scripts/backfill-scholar-metrics.js
 *   node scripts/backfill-scholar-metrics.js --dry-run
 *   node scripts/backfill-scholar-metrics.js --limit 20 --delay 1500
 *
 * Requires SERPAPI_KEY in .env (recommended). Each faculty = 1 SerpApi search,
 * so mind the free-tier quota (100/month). Use --limit to cap a run.
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import Faculty from "../src/models/faculty.js";
// Use fetchScholarData (live SerpAPI call) instead of getScholarResearchBlock.
// getScholarResearchBlock short-circuits to the DB when papers are already
// stored there, reading h_index from the Faculty document — which is 0 —
// and writing 0 back. fetchScholarData always goes to the API for live metrics.
import { fetchScholarData } from "../src/utils/fetchScholarData.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const argv = process.argv.slice(2);
const hasFlag = (name) => argv.includes(name);
const getOpt = (name, fallback) => {
    const i = argv.indexOf(name);
    return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};

const DRY_RUN = hasFlag("--dry-run");
const LIMIT = Number(getOpt("--limit", "0")) || 0; // 0 = no limit
const DELAY_MS = Number(getOpt("--delay", "1200")) || 1200;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const run = async () => {
    if (!process.env.MONGO_URI) {
        console.error("MONGO_URI not set in .env");
        process.exit(1);
    }
    if (!process.env.SERPAPI_KEY) {
        console.warn(
            "WARNING: SERPAPI_KEY not set — the scholarly fallback is usually blocked, " +
                "so most fetches will fail. Set SERPAPI_KEY for reliable results."
        );
    }

    await mongoose.connect(process.env.MONGO_URI);
    console.log("DB connected");

    // Faculty with no scopus id but a google scholar id.
    const candidates = await Faculty.find({
        $and: [
            { $or: [{ scopus_id: { $exists: false } }, { scopus_id: { $size: 0 } }] },
            { google_scholar_id: { $exists: true, $not: { $size: 0 } } },
        ],
    }).lean();

    const targets = LIMIT > 0 ? candidates.slice(0, LIMIT) : candidates;
    console.log(
        `Found ${candidates.length} Scholar-only faculty; processing ${targets.length}` +
            (DRY_RUN ? " (dry-run)" : "")
    );

    let updated = 0;
    let failed = 0;
    for (let i = 0; i < targets.length; i++) {
        const faculty = targets[i];
        const name = [faculty.title, faculty.firstName, faculty.lastName].filter(Boolean).join(" ");
        const scholarId = (faculty.google_scholar_id || [])[0];
        process.stdout.write(`[${i + 1}/${targets.length}] ${name} (${scholarId}) ... `);

        try {
            const scholar = await fetchScholarData(scholarId);
            if (!scholar) {
                failed++;
                console.log("no data");
            } else {
                const hIndex       = Number.isFinite(scholar.hIndex)    ? scholar.hIndex    : 0;
                const citationCount = Number.isFinite(scholar.citations) ? scholar.citations : 0;
                console.log(`h-index=${hIndex}, citations=${citationCount}`);
                if (!DRY_RUN) {
                    await Faculty.updateOne(
                        { _id: faculty._id },
                        { $set: { h_index: hIndex, citation_count: citationCount } }
                    );
                    updated++;
                }
            }
        } catch (err) {
            failed++;
            console.log(`error: ${err.message}`);
        }

        if (i < targets.length - 1) await sleep(DELAY_MS);
    }

    console.log(`\nDone. Updated: ${updated}, Failed: ${failed}, Total: ${targets.length}`);
    await mongoose.disconnect();
    process.exit(0);
};

run().catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
});
