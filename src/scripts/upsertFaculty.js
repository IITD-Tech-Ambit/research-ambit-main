/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║           Faculty Upsert Script — Research Ambit            ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  • Adds NEW faculty documents                               ║
 * ║  • Updates EXISTING faculty (h_index, citations, etc.)      ║
 * ║  • Creates departments automatically if missing             ║
 * ║  • Runs safely — never deletes data                         ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Usage:
 *   node src/scripts/upsertFaculty.js
 *   node src/scripts/upsertFaculty.js --file data/my-custom-file.json
 *   node src/scripts/upsertFaculty.js --dry-run        ← preview only, no DB writes
 *   node src/scripts/upsertFaculty.js --only-stats     ← update h_index & citations only
 *
 * Input file format: data/faculty-upsert.json
 * See that file for a full example with all fields.
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Parse CLI flags ─────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN    = args.includes('--dry-run');
const ONLY_STATS = args.includes('--only-stats');
const fileFlag   = args.indexOf('--file');
const inputFile  = fileFlag !== -1
    ? path.resolve(args[fileFlag + 1])
    : path.join(__dirname, '../../data/faculty-upsert.json');

// ── Lazy-load models (ES module compatible) ──────────────────────────────────
const loadModels = async () => {
    const { default: Faculty }    = await import('../models/faculty.js');
    const { default: Department } = await import('../models/departments.js');
    return { Faculty, Department };
};

// ── Helpers ──────────────────────────────────────────────────────────────────
const log  = (msg) => console.log(`  ${msg}`);
const ok   = (msg) => console.log(`  ✅ ${msg}`);
const warn = (msg) => console.warn(`  ⚠️  ${msg}`);
const err  = (msg) => console.error(`  ❌ ${msg}`);

/** Find or create a Department by its code. Returns the ObjectId. */
const resolveDepartment = async (Department, deptCache, code, name) => {
    if (!code) return null;
    const key = code.toUpperCase();
    if (deptCache.has(key)) return deptCache.get(key);

    let dept = await Department.findOne({ code: key });
    if (!dept) {
        if (DRY_RUN) {
            warn(`[DRY-RUN] Would create department: code="${key}", name="${name || key}"`);
            deptCache.set(key, null);
            return null;
        }
        dept = await Department.create({ code: key, name: name || key, category: 'Department' });
        ok(`Created new department: ${dept.name} (${dept.code})`);
    }
    deptCache.set(key, dept._id);
    return dept._id;
};

/** Build the update payload from a record. */
const buildPayload = (record, deptId) => {
    const always = {
        h_index:        record.h_index        ?? undefined,
        citation_count: record.citation_count  ?? undefined,
    };

    if (ONLY_STATS) return always;

    return {
        ...always,
        ...(record.title              && { title:              record.title }),
        ...(record.firstName          && { firstName:          record.firstName }),
        ...(record.lastName           && { lastName:           record.lastName }),
        ...(record.email              && { email:              record.email }),
        ...(record.gender             && { gender:             record.gender }),
        ...(deptId                    && { department:         deptId }),
        ...(record.designation        && { designation:        record.designation }),
        ...(record.working_from_year  && { working_from_year:  record.working_from_year }),
        ...(record.profile_image_url  && { profile_image_url:  record.profile_image_url }),
        ...(record.expertise          && { expertise:          record.expertise }),
        ...(record.brief_expertise    && { brief_expertise:    record.brief_expertise }),
        ...(record.subjects           && { subjects:           record.subjects }),
        ...(record.wos_subjects       && { wos_subjects:       record.wos_subjects }),
        ...(record.scopus_id          && { scopus_id:          record.scopus_id }),
        ...(record.orcid_id           && { orcid_id:           record.orcid_id }),
        ...(record.researcher_id      && { researcher_id:      record.researcher_id }),
        ...(record.google_scholar_id  && { google_scholar_id:  record.google_scholar_id }),
        ...(record.subject            && { subject:            record.subject }),
        ...(record.expertise_id       && { expertise_id:       record.expertise_id }),
        ...(record.qualification_id   && { qualification_id:   record.qualification_id }),
    };
};

// ── Validate a record before processing ─────────────────────────────────────
const validate = (record, idx) => {
    const issues = [];
    if (!record.expert_id)    issues.push('missing expert_id (required)');
    if (!record.experience_id && !record._skipNew)
        issues.push('missing experience_id (required for new faculty)');
    if (!record.firstName)    issues.push('missing firstName');
    if (!record.lastName)     issues.push('missing lastName');
    if (!record.email)        issues.push('missing email');
    if (record.gender && !['Male', 'Female', 'Other'].includes(record.gender))
        issues.push(`invalid gender "${record.gender}" — must be Male / Female / Other`);
    return issues;
};

// ── Main ─────────────────────────────────────────────────────────────────────
const run = async () => {
    console.log('\n╔══════════════════════════════════════════════╗');
    console.log('║      Faculty Upsert — Research Ambit         ║');
    console.log('╚══════════════════════════════════════════════╝');
    if (DRY_RUN)    console.log('  🔍 DRY-RUN mode — no changes will be saved');
    if (ONLY_STATS) console.log('  📊 ONLY-STATS mode — updating h_index & citations only');
    console.log('');

    if (!fs.existsSync(inputFile)) {
        err(`Input file not found: ${inputFile}`);
        err(`Create the file and fill in your faculty data.`);
        process.exit(1);
    }

    let records;
    try {
        records = JSON.parse(fs.readFileSync(inputFile, 'utf-8'));
        if (!Array.isArray(records)) throw new Error('Root must be a JSON array [ ... ]');
    } catch (e) {
        err(`Failed to parse JSON: ${e.message}`);
        process.exit(1);
    }

    log(`Loaded ${records.length} records from ${path.basename(inputFile)}`);
    console.log('');

    await mongoose.connect(process.env.MONGODB_URI);
    ok('Database connected\n');

    const { Faculty, Department } = await loadModels();
    const deptCache = new Map();

    let created = 0, updated = 0, skipped = 0, failed = 0;
    const failedRecords = [];

    const BATCH = 100;
    for (let i = 0; i < records.length; i += BATCH) {
        const batch = records.slice(i, i + BATCH);
        const batchNum = Math.floor(i / BATCH) + 1;
        const totalBatches = Math.ceil(records.length / BATCH);
        console.log(`  ── Batch ${batchNum}/${totalBatches} ─────────────────────────`);

        for (const [j, record] of batch.entries()) {
            const idx = i + j + 1;
            const label = `[${idx}] ${record.firstName || '?'} ${record.lastName || ''} (${record.expert_id || 'NO-ID'})`;

            const issues = validate(record, idx);

            const existing = record.expert_id
                ? await Faculty.findOne({ expert_id: record.expert_id })
                : null;

            // For updates, validation is more lenient (only expert_id required)
            if (!existing && issues.length > 0) {
                warn(`${label} — skipped: ${issues.join('; ')}`);
                skipped++;
                failedRecords.push({ record: label, reason: issues.join('; ') });
                continue;
            }

            const deptId = await resolveDepartment(
                Department,
                deptCache,
                record.department_code,
                record.department_name
            );

            const payload = buildPayload(record, deptId);

            try {
                if (DRY_RUN) {
                    if (existing) {
                        log(`[DRY-RUN] Would UPDATE ${label}`);
                        log(`          Fields: ${Object.keys(payload).join(', ')}`);
                    } else {
                        log(`[DRY-RUN] Would INSERT ${label}`);
                    }
                    continue;
                }

                if (existing) {
                    await Faculty.updateOne(
                        { expert_id: record.expert_id },
                        { $set: payload }
                    );
                    ok(`UPDATED  ${label}`);
                    updated++;
                } else {
                    // Insert — need experience_id (already validated above)
                    await Faculty.create({
                        expert_id:     record.expert_id,
                        experience_id: record.experience_id,
                        title:         record.title || 'Prof.',
                        firstName:     record.firstName,
                        lastName:      record.lastName,
                        email:         record.email,
                        gender:        record.gender || 'Male',
                        department:    deptId,
                        ...payload,
                    });
                    ok(`INSERTED ${label}`);
                    created++;
                }
            } catch (e) {
                err(`FAILED   ${label} — ${e.message}`);
                failed++;
                failedRecords.push({ record: label, reason: e.message });
            }
        }
        console.log('');
    }

    console.log('╔══════════════════════════════════════════════╗');
    console.log('║                   Summary                    ║');
    console.log('╠══════════════════════════════════════════════╣');
    console.log(`║  Total records  : ${String(records.length).padEnd(26)}║`);
    console.log(`║  ✅ Inserted    : ${String(created).padEnd(26)}║`);
    console.log(`║  ✅ Updated     : ${String(updated).padEnd(26)}║`);
    console.log(`║  ⚠️  Skipped    : ${String(skipped).padEnd(25)}║`);
    console.log(`║  ❌ Failed      : ${String(failed).padEnd(26)}║`);
    console.log('╚══════════════════════════════════════════════╝');

    if (failedRecords.length > 0) {
        console.log('\n  Failed / Skipped details:');
        failedRecords.forEach(({ record, reason }) => {
            console.log(`    • ${record}`);
            console.log(`      → ${reason}`);
        });
    }

    if (failedRecords.length > 0 && !DRY_RUN) {
        const logPath = path.join(__dirname, '../../data/upsert-errors.json');
        fs.writeFileSync(logPath, JSON.stringify(failedRecords, null, 2));
        console.log(`\n  Error log saved to: data/upsert-errors.json`);
    }

    await mongoose.disconnect();
    console.log('\n  🔌 Disconnected. Done.\n');
};

run().catch((e) => {
    err(`Unhandled error: ${e.message}`);
    console.error(e);
    process.exit(1);
});
