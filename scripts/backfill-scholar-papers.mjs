/**
 * Backfill Google Scholar papers into researchmetadatascopus.
 *
 * Covers ALL faculty who have a google_scholar_id AND currently have 0 papers
 * stored in the DB (neither Scopus nor Scholar papers found). This includes:
 *   - Scholar-only faculty (no scopus_id)
 *   - Faculty with both Scopus + Scholar IDs but 0 papers in DB
 *
 * Safety:
 *  - Upsert on document_eid  →  safe to re-run, never creates duplicates
 *  - $setOnInsert             →  never overwrites an existing document
 *  - Rate-limited             →  one faculty every DELAY_MS ms (default 3 s)
 *
 * Usage:
 *   node scripts/backfill-scholar-papers.mjs             # all with 0 papers
 *   node scripts/backfill-scholar-papers.mjs --dry-run   # preview only
 *   node scripts/backfill-scholar-papers.mjs --limit 10  # first 10 faculty
 *   node scripts/backfill-scholar-papers.mjs --all       # re-run everyone
 */

import { spawn }        from "child_process";
import crypto           from "crypto";
import path             from "path";
import { fileURLToPath } from "url";
import mongoose         from "mongoose";
import dotenv           from "dotenv";

// Load .env from the project root so SERPAPI_KEY and MONGODB_URI are available.
dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env") });

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Config ──────────────────────────────────────────────────────────────────

const MONGODB_URI   = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  throw new Error("MONGODB_URI environment variable is required");
}
const PYTHON_BIN  = process.env.PYTHON_BIN  || "python";
const SCRIPT_PATH = path.resolve(__dirname, "../src/python/fetch_scholar.py");
const TIMEOUT_MS  = Number(process.env.SCHOLAR_TIMEOUT_MS)  || 60_000;
const DELAY_MS    = Number(process.env.SCHOLAR_DELAY_MS)     || 3_000;

const args     = process.argv.slice(2);
const DRY_RUN  = args.includes("--dry-run");
const FORCE    = args.includes("--all");  // include faculty who already have papers
const limitArg = args.indexOf("--limit");
const LIMIT    = limitArg !== -1 ? Number(args[limitArg + 1]) : null;

// ── Schema (mirrors src/models/research_scopus.js) ──────────────────────────

const AuthorSchema = new mongoose.Schema({
    author_id:              { type: String, required: true },
    author_position:        { type: String },
    author_name:            { type: String, required: true },
    author_avaialable_names:[{ type: String }],
});

const ResearchSchema = new mongoose.Schema(
    {
        document_eid:       { type: String, required: true, unique: true },
        document_scopus_id: { type: String, required: true, unique: true },
        link:               { type: String },
        publication_year:   { type: Number },
        document_type:      { type: String },
        citation_count:     { type: Number },
        reference_count:    { type: Number },
        title:              { type: String, required: true },
        abstract:           { type: String, required: true },
        field_associated:   { type: String },
        subject_area:       [{ type: String }],
        authors:            [AuthorSchema],
        kerberos:           { type: String },
        open_search_id:     { type: String, required: true, unique: true },
    },
    { timestamps: true }
);

const FacultySchema = new mongoose.Schema({}, { strict: false });

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeEid(title, year) {
    return (
        "scholar_" +
        crypto
            .createHash("md5")
            .update(`${(title || "").toLowerCase().trim()}_${year ?? ""}`)
            .digest("hex")
            .slice(0, 16)
    );
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function runScholarScript(scholarId) {
    return new Promise((resolve) => {
        let settled = false;
        const finish = (v) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } };

        let child;
        try {
            child = spawn(PYTHON_BIN, [SCRIPT_PATH, scholarId], {
                windowsHide: true,
                env: { ...process.env },
            });
        } catch (err) {
            console.error(`  [spawn error] ${err.message}`);
            return resolve(null);
        }

        const timer = setTimeout(() => {
            try { child.kill(); } catch { /* ignore */ }
            console.error(`  [timeout] ${TIMEOUT_MS}ms for scholar id ${scholarId}`);
            finish(null);
        }, TIMEOUT_MS);

        let stdout = "", stderr = "";
        child.stdout.on("data", (c) => (stdout += c.toString()));
        child.stderr.on("data", (c) => (stderr += c.toString()));
        child.on("error", (err) => { console.error(`  [process error] ${err.message}`); finish(null); });
        child.on("close", (code) => {
            if (code !== 0) {
                console.error(`  [exit ${code}] ${stderr.trim().slice(0, 200)}`);
                return finish(null);
            }
            try { finish(JSON.parse(stdout)); }
            catch (e) { console.error(`  [json parse error] ${e.message}`); finish(null); }
        });
    });
}

async function upsertPapers(ResearchDoc, faculty, schId, papers) {
    if (!papers.length) return { inserted: 0, skipped: 0 };

    // Kerberos = email prefix, same format as Scopus papers.
    // e.g. "kkdeepak@cbme.iitd.ac.in" → "kkdeepak"
    const kerberos = (faculty.email || "").split("@")[0].toLowerCase();

    const ops = papers
        .filter((p) => p?.title?.trim())
        .map((paper) => {
            const eid = makeEid(paper.title, paper.year);
            const authorList = (Array.isArray(paper.authors) ? paper.authors : []).map(
                (name, idx, arr) => ({
                    author_id:      "",
                    author_name:    typeof name === "string" ? name.trim() : String(name),
                    author_position: idx === 0 ? "first" : idx === arr.length - 1 ? "last" : "middle",
                })
            );
            return {
                updateOne: {
                    filter: { document_eid: eid },
                    update: {
                        $set: { kerberos },          // always stamp kerberos (fixes previous empty-kerberos inserts)
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

    if (DRY_RUN) {
        console.log(`  [dry-run] would upsert ${ops.length} paper(s)`);
        return { inserted: 0, skipped: ops.length };
    }

    const result = await ResearchDoc.bulkWrite(ops, { ordered: false });
    return { inserted: result.upsertedCount ?? 0, skipped: ops.length - (result.upsertedCount ?? 0) };
}

// ── Main ─────────────────────────────────────────────────────────────────────

await mongoose.connect(MONGODB_URI);
console.log(`MongoDB connected → ${mongoose.connection.db.databaseName}`);
if (DRY_RUN) console.log("DRY-RUN mode — nothing will be written.\n");

const ResearchDoc = mongoose.model("ResearchMetaDataScopus", ResearchSchema, "researchmetadatascopus");
const Faculty     = mongoose.model("Faculty", FacultySchema, "faculties");

// Find ALL faculty with a Scholar ID.
const allWithScholar = await Faculty.find({
    google_scholar_id: { $exists: true, $not: { $size: 0 } },
}).lean();

// Unless --all, filter to only those with 0 papers in DB.
// Threshold: fetch Scholar papers if total stored papers (Scopus + Scholar) < MIN_PAPERS.
// Faculty with many Scopus papers already (e.g. 200+) are skipped.
// Faculty with only a handful of Scopus papers but a rich Scholar profile are included.
const MIN_PAPERS = 10;

let facultyList = allWithScholar;
if (!FORCE) {
    const col = mongoose.connection.db.collection("researchmetadatascopus");
    const withEnoughPapers = new Set();

    for (const f of allWithScholar) {
        const kerberos  = (f.email || "").split("@")[0].toLowerCase();
        const scopusIds = (f.scopus_id || []).filter(Boolean);
        let total = 0;

        // Count Scholar papers already stored via kerberos
        if (kerberos) {
            total += await col.countDocuments({ kerberos, document_eid: { $regex: "^scholar_" } });
        }
        // Count Scopus papers via author_id
        for (const sid of scopusIds) {
            total += await col.countDocuments({ "authors.author_id": sid });
        }
        if (total >= MIN_PAPERS) withEnoughPapers.add(String(f._id));
    }
    facultyList = allWithScholar.filter(f => !withEnoughPapers.has(String(f._id)));
    console.log(`${allWithScholar.length} faculty have Scholar IDs → ${facultyList.length} have fewer than ${MIN_PAPERS} papers in DB.\n`);
} else {
    console.log(`--all mode: processing all ${facultyList.length} Scholar faculty.\n`);
}

if (LIMIT) facultyList = facultyList.slice(0, LIMIT);

let totalInserted = 0;
let totalSkipped  = 0;
let totalFailed   = 0;

for (let i = 0; i < facultyList.length; i++) {
    const f      = facultyList[i];
    const name   = [f.title, f.firstName, f.lastName].filter(Boolean).join(" ") || String(f._id);
    const schId  = (Array.isArray(f.google_scholar_id) ? f.google_scholar_id : [f.google_scholar_id])
                    .find((s) => typeof s === "string" && s.trim());

    console.log(`[${i + 1}/${facultyList.length}] ${name}  (scholar: ${schId})`);

    if (!schId) {
        console.log("  ↳ no valid scholar id — skip");
        totalFailed++;
        continue;
    }

    const data = await runScholarScript(schId);
    if (!data) {
        console.log("  ↳ fetch failed — skip");
        totalFailed++;
    } else {
        const papers = Array.isArray(data.papers) ? data.papers : [];
        console.log(`  ↳ fetched ${papers.length} paper(s)  hIndex=${data.hIndex}  citations=${data.citations}`);
        const { inserted, skipped } = await upsertPapers(ResearchDoc, f, schId, papers);
        console.log(`  ↳ inserted ${inserted} new  /  ${skipped} already existed`);
        totalInserted += inserted;
        totalSkipped  += skipped;
    }

    if (i < facultyList.length - 1) await sleep(DELAY_MS);
}

console.log("\n══════════════════════════════════════");
console.log(" Backfill complete");
console.log(`  Faculty processed : ${facultyList.length}`);
console.log(`  Papers inserted   : ${totalInserted}`);
console.log(`  Already existed   : ${totalSkipped}`);
console.log(`  Failed / skipped  : ${totalFailed}`);
console.log("══════════════════════════════════════");

await mongoose.disconnect();
