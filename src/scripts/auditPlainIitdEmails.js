/**
 * Audit faculty who still use plain @iitd.ac.in emails (no department subdomain).
 *
 * Lists faculty where email is exactly kerberos@iitd.ac.in — not kerberos@ee.iitd.ac.in.
 * Excludes faculty whose department category is "Other".
 *
 * Usage:
 *   node src/scripts/auditPlainIitdEmails.js
 *   node src/scripts/auditPlainIitdEmails.js --json
 *   node src/scripts/auditPlainIitdEmails.js --include-other   ← also show "Other" category
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const WRITE_JSON = args.includes("--json");
const INCLUDE_OTHER = args.includes("--include-other");

const log = (msg) => console.log(`  ${msg}`);
const ok = (msg) => console.log(`  ✅ ${msg}`);
const err = (msg) => console.error(`  ❌ ${msg}`);

/** True when email is kerberos@iitd.ac.in (no dept subdomain). */
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

const formatName = (f) =>
  [f.title, f.firstName, f.lastName].filter(Boolean).join(" ").trim();

const run = async () => {
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║   Plain @iitd.ac.in Faculty Audit               ║");
  console.log("╚══════════════════════════════════════════════════╝");
  if (INCLUDE_OTHER) {
    console.log("  Including departments with category \"Other\"");
  } else {
    console.log("  Excluding departments with category \"Other\"");
  }
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

  const plainEmailFaculty = allFaculty.filter((f) => isPlainIitdEmail(f.email));

  const matched = plainEmailFaculty.filter((f) => {
    const category = f.department?.category ?? "Other";
    return INCLUDE_OTHER || category !== "Other";
  });

  const excludedOther = plainEmailFaculty.length - matched.length;

  if (matched.length === 0) {
    log("No matching faculty found.");
  } else {
    console.log(
      "  Kerberos".padEnd(22) +
        "Name".padEnd(28) +
        "Department".padEnd(22) +
        "Code".padEnd(10) +
        "Category"
    );
    console.log("  " + "─".repeat(88));

    for (const f of matched.sort((a, b) =>
      (a.department?.name ?? "").localeCompare(b.department?.name ?? "")
    )) {
      const kerberos = kerberosFromEmail(f.email);
      const deptName = f.department?.name ?? "(none)";
      const deptCode = f.department?.code ?? "?";
      const category = f.department?.category ?? "Other";

      console.log(
        "  " +
          kerberos.padEnd(20) +
          formatName(f).slice(0, 26).padEnd(28) +
          deptName.slice(0, 20).padEnd(22) +
          deptCode.padEnd(10) +
          category
      );
      log(`     ${f.email}`);
    }
  }

  const byCategory = {};
  const byDepartment = {};
  for (const f of matched) {
    const cat = f.department?.category ?? "Other";
    const dept = f.department?.name ?? "(none)";
    byCategory[cat] = (byCategory[cat] || 0) + 1;
    byDepartment[dept] = (byDepartment[dept] || 0) + 1;
  }

  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║                     Summary                      ║");
  console.log("╠══════════════════════════════════════════════════╣");
  console.log(`║  Total faculty in DB       : ${String(allFaculty.length).padEnd(21)}║`);
  console.log(`║  Plain @iitd.ac.in (all)   : ${String(plainEmailFaculty.length).padEnd(21)}║`);
  console.log(`║  Excluded (category Other) : ${String(excludedOther).padEnd(21)}║`);
  console.log(`║  Listed below              : ${String(matched.length).padEnd(21)}║`);
  console.log("╚══════════════════════════════════════════════════╝");

  if (Object.keys(byCategory).length > 0) {
    console.log("\n  By category:");
    Object.entries(byCategory)
      .sort((a, b) => b[1] - a[1])
      .forEach(([cat, count]) => console.log(`    • ${cat}: ${count}`));
  }

  if (Object.keys(byDepartment).length > 0) {
    console.log("\n  By department:");
    Object.entries(byDepartment)
      .sort((a, b) => b[1] - a[1])
      .forEach(([dept, count]) => console.log(`    • ${dept}: ${count}`));
  }

  const report = matched.map((f) => ({
    kerberos: kerberosFromEmail(f.email),
    name: formatName(f),
    email: f.email,
    department: f.department?.name ?? null,
    departmentCode: f.department?.code ?? null,
    departmentCategory: f.department?.category ?? null,
    expert_id: f.expert_id,
  }));

  if (WRITE_JSON) {
    const outPath = path.join(__dirname, "../../data/plain-iitd-emails-audit.json");
    fs.writeFileSync(
      outPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          includeOther: INCLUDE_OTHER,
          totalPlainEmail: plainEmailFaculty.length,
          excludedOtherCategory: excludedOther,
          count: matched.length,
          faculty: report,
        },
        null,
        2
      )
    );
    console.log(`\n  Report saved to: data/plain-iitd-emails-audit.json`);
  }

  await mongoose.disconnect();
  console.log("\n  🔌 Disconnected. Done.\n");
};

run().catch((e) => {
  err(`Unhandled error: ${e.message}`);
  console.error(e);
  process.exit(1);
});
