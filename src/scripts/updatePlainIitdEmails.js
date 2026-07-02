/**
 * Bulk-update faculty emails from plain @iitd.ac.in to @<dept_code>.iitd.ac.in
 * using each faculty member's current department code.
 *
 * Targets the same set as auditPlainIitdEmails.js (excludes category "Other").
 * Department is not changed — email only.
 *
 * Usage:
 *   node src/scripts/updatePlainIitdEmails.js --dry-run
 *   node src/scripts/updatePlainIitdEmails.js
 *   node src/scripts/updatePlainIitdEmails.js --include-other
 *   node src/scripts/updatePlainIitdEmails.js --limit 10 --dry-run
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const INCLUDE_OTHER = args.includes("--include-other");
const limitFlag = args.indexOf("--limit");
const LIMIT =
  limitFlag !== -1 ? Math.max(0, Number(args[limitFlag + 1]) || 0) : 0;

const log = (msg) => console.log(`  ${msg}`);
const ok = (msg) => console.log(`  ✅ ${msg}`);
const warn = (msg) => console.warn(`  ⚠️  ${msg}`);
const err = (msg) => console.error(`  ❌ ${msg}`);

const isPlainIitdEmail = (email) => {
  const e = String(email || "").trim().toLowerCase();
  const at = e.indexOf("@");
  if (at <= 0) return false;
  return e.slice(at + 1) === "iitd.ac.in";
};

const kerberosFromEmail = (email) => {
  const e = String(email || "").trim().toLowerCase();
  const at = e.indexOf("@");
  return at > 0 ? e.slice(0, at) : "";
};

const buildDeptEmail = (kerberos, departmentCode) =>
  `${kerberos.toLowerCase()}@${String(departmentCode).toLowerCase()}.iitd.ac.in`;

const formatName = (f) =>
  [f.title, f.firstName, f.lastName].filter(Boolean).join(" ").trim();

const run = async () => {
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║   Plain @iitd.ac.in → Dept Email Bulk Update    ║");
  console.log("╚══════════════════════════════════════════════════╝");
  if (DRY_RUN) console.log("  🔍 DRY-RUN — no database writes");
  if (INCLUDE_OTHER) console.log("  Including departments with category \"Other\"");
  if (LIMIT > 0) console.log(`  Limit: ${LIMIT} records`);
  console.log("");

  if (!process.env.MONGO_URI) {
    err("MONGO_URI not set in .env");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  ok("Database connected\n");

  const { default: Faculty } = await import("../models/faculty.js");
  await import("../models/departments.js");

  const allFaculty = await Faculty.find({}, "title firstName lastName email department expert_id")
    .populate("department", "name code category")
    .lean();

  const emailOwners = new Map(
    allFaculty.map((f) => [String(f.email || "").trim().toLowerCase(), String(f._id)])
  );

  let candidates = allFaculty.filter((f) => {
    if (!isPlainIitdEmail(f.email)) return false;
    const category = f.department?.category ?? "Other";
    return INCLUDE_OTHER || category !== "Other";
  });

  if (LIMIT > 0) candidates = candidates.slice(0, LIMIT);

  const stats = { updated: 0, skipped: 0, failed: 0, unchanged: 0 };
  const failures = [];
  const updates = [];

  for (const f of candidates) {
    const kerberos = kerberosFromEmail(f.email);
    const deptCode = f.department?.code;
    const label = `${formatName(f)} (${kerberos})`;

    if (!kerberos) {
      warn(`SKIP ${label} — invalid email: ${f.email}`);
      stats.skipped++;
      failures.push({ kerberos, email: f.email, reason: "invalid email" });
      continue;
    }

    if (!deptCode) {
      warn(`SKIP ${label} — department has no code`);
      stats.skipped++;
      failures.push({ kerberos, email: f.email, reason: "missing department code" });
      continue;
    }

    const targetEmail = buildDeptEmail(kerberos, deptCode);
    const currentEmail = String(f.email).trim().toLowerCase();

    if (targetEmail === currentEmail) {
      stats.unchanged++;
      continue;
    }

    const existingOwner = emailOwners.get(targetEmail);
    if (existingOwner && existingOwner !== String(f._id)) {
      warn(`SKIP ${label} — target email already taken: ${targetEmail}`);
      stats.skipped++;
      failures.push({
        kerberos,
        email: f.email,
        targetEmail,
        reason: "target email already exists on another faculty",
      });
      continue;
    }

    const change = `${f.email} → ${targetEmail} (${f.department?.name}, ${deptCode})`;
    updates.push({ kerberos, name: formatName(f), change, expert_id: f.expert_id });

    if (DRY_RUN) {
      log(`[DRY-RUN] Would update ${label}: ${change}`);
      stats.updated++;
      continue;
    }

    try {
      await Faculty.updateOne({ _id: f._id }, { $set: { email: targetEmail } });
      emailOwners.delete(currentEmail);
      emailOwners.set(targetEmail, String(f._id));
      ok(`UPDATED ${label}: ${change}`);
      stats.updated++;
    } catch (e) {
      err(`FAILED ${label} — ${e.message}`);
      stats.failed++;
      failures.push({ kerberos, email: f.email, targetEmail, reason: e.message });
    }
  }

  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║                     Summary                      ║");
  console.log("╠══════════════════════════════════════════════════╣");
  console.log(`║  Candidates              : ${String(candidates.length).padEnd(21)}║`);
  console.log(`║  ✅ Updated              : ${String(stats.updated).padEnd(21)}║`);
  console.log(`║  ⏭  Skipped              : ${String(stats.skipped).padEnd(21)}║`);
  console.log(`║  — Unchanged             : ${String(stats.unchanged).padEnd(21)}║`);
  console.log(`║  ❌ Failed               : ${String(stats.failed).padEnd(21)}║`);
  console.log("╚══════════════════════════════════════════════════╝");

  const reportDir = path.join(__dirname, "../../data");

  if (failures.length > 0) {
    const failPath = path.join(reportDir, "plain-iitd-email-update-errors.json");
    fs.writeFileSync(failPath, JSON.stringify(failures, null, 2));
    console.log(`\n  Errors saved to: data/plain-iitd-email-update-errors.json`);
  }

  if (updates.length > 0) {
    const planPath = path.join(
      reportDir,
      DRY_RUN ? "plain-iitd-email-update-plan.json" : "plain-iitd-email-update-applied.json"
    );
    fs.writeFileSync(
      planPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          dryRun: DRY_RUN,
          count: updates.length,
          updates,
        },
        null,
        2
      )
    );
    console.log(
      `  ${DRY_RUN ? "Plan" : "Applied log"} saved to: data/${path.basename(planPath)}`
    );
  }

  if (DRY_RUN && updates.length > 0) {
    console.log("\n  Sample planned updates (first 5):");
    updates.slice(0, 5).forEach((u) => console.log(`    • ${u.kerberos}: ${u.change}`));
    if (updates.length > 5) {
      console.log(`    … and ${updates.length - 5} more`);
    }
    console.log("\n  Run without --dry-run to apply.");
  }

  await mongoose.disconnect();
  console.log("\n  🔌 Disconnected. Done.\n");
};

run().catch((e) => {
  err(`Unhandled error: ${e.message}`);
  console.error(e);
  process.exit(1);
});
