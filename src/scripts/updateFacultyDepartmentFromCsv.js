/**
 * Update faculty department + email from a CSV of kerberos IDs and department codes.
 *
 * Email rules (IITD):
 *   • Plain central:  kerberos@iitd.ac.in
 *   • Department:     kerberos@<dept_code>.iitd.ac.in  (e.g. bsingh@ee.iitd.ac.in)
 *
 * Rows whose email is already @<dept>.iitd.ac.in are checked against the CSV code.
 * Rows with plain @iitd.ac.in are flagged (likely central IITD staff) but the
 * department is still updated when it does not match. Use --force to also rewrite
 * those emails to @<dept_code>.iitd.ac.in.
 *
 * Usage:
 *   node src/scripts/updateFacultyDepartmentFromCsv.js
 *   node src/scripts/updateFacultyDepartmentFromCsv.js --file data/faculty-dept-update.csv
 *   node src/scripts/updateFacultyDepartmentFromCsv.js --dry-run
 *   node src/scripts/updateFacultyDepartmentFromCsv.js --force
 *
 * CSV columns (header required, names flexible):
 *   kerberos_id, department_code
 *   kerberos, dept_code
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
const FORCE = args.includes("--force");
const fileFlag = args.indexOf("--file");
const inputFile =
  fileFlag !== -1
    ? path.resolve(args[fileFlag + 1])
    : path.join(__dirname, "../../data/faculty-dept-update.csv");

const log = (msg) => console.log(`  ${msg}`);
const ok = (msg) => console.log(`  ✅ ${msg}`);
const warn = (msg) => console.warn(`  ⚠️  ${msg}`);
const err = (msg) => console.error(`  ❌ ${msg}`);

const KERBEROS_KEYS = new Set([
  "kerberos_id",
  "kerberos",
  "kerb",
  "id",
  "username",
]);
const DEPT_KEYS = new Set([
  "department_code",
  "dept_code",
  "department",
  "dept",
  "code",
]);

/** Minimal CSV parser — handles quoted fields and commas inside quotes. */
const parseCsv = (text) => {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field.trim());
      field = "";
    } else if (ch === "\n" || (ch === "\r" && next === "\n")) {
      row.push(field.trim());
      field = "";
      if (row.some((c) => c.length > 0)) rows.push(row);
      row = [];
      if (ch === "\r") i++;
    } else if (ch !== "\r") {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field.trim());
    if (row.some((c) => c.length > 0)) rows.push(row);
  }

  return rows;
};

const normalizeHeader = (h) =>
  String(h || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");

const rowsFromCsv = (filePath) => {
  const raw = fs.readFileSync(filePath, "utf-8");
  const table = parseCsv(raw);
  if (table.length < 2) {
    throw new Error("CSV must have a header row and at least one data row");
  }

  const headers = table[0].map(normalizeHeader);
  const kerberosIdx = headers.findIndex((h) => KERBEROS_KEYS.has(h));
  const deptIdx = headers.findIndex((h) => DEPT_KEYS.has(h));

  if (kerberosIdx === -1 || deptIdx === -1) {
    throw new Error(
      `CSV must include kerberos and department_code columns. Found: ${headers.join(", ")}`
    );
  }

  return table.slice(1).map((cells, i) => ({
    line: i + 2,
    kerberos: String(cells[kerberosIdx] || "").trim().toLowerCase(),
    departmentCode: String(cells[deptIdx] || "").trim().toUpperCase(),
  }));
};

/** Parse IITD faculty email into kerberos + subdomain type. */
const parseIitdEmail = (email) => {
  const e = String(email || "").trim().toLowerCase();
  const at = e.indexOf("@");
  if (at <= 0) return { kerberos: "", kind: "invalid", subdomain: null, domain: "" };

  const kerberos = e.slice(0, at);
  const domain = e.slice(at + 1);

  if (domain === "iitd.ac.in") {
    return { kerberos, kind: "central", subdomain: null, domain };
  }

  const match = domain.match(/^([a-z0-9_-]+)\.iitd\.ac\.in$/);
  if (match) {
    return { kerberos, kind: "department", subdomain: match[1], domain };
  }

  return { kerberos, kind: "other", subdomain: null, domain };
};

const buildDeptEmail = (kerberos, departmentCode) =>
  `${kerberos.toLowerCase()}@${departmentCode.toLowerCase()}.iitd.ac.in`;

const escapeRegex = (input = "") => input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const findFacultyByKerberos = async (Faculty, kerberos) =>
  Faculty.findOne({
    email: { $regex: `^${escapeRegex(kerberos)}@`, $options: "i" },
  }).populate("department", "name code");

const classifyRow = (faculty, departmentCode, forceEmail) => {
  const parsed = parseIitdEmail(faculty.email);
  const expectedSubdomain = departmentCode.toLowerCase();
  const targetEmail = buildDeptEmail(parsed.kerberos || "", departmentCode);

  if (parsed.kind === "central") {
    return {
      action: "flag_central",
      reason: "Email uses plain @iitd.ac.in — likely central IITD staff",
      targetEmail,
      updateEmail: forceEmail,
    };
  }

  if (parsed.kind === "department") {
    if (parsed.subdomain === expectedSubdomain) {
      return {
        action: "dept_only",
        reason: "Email already has matching department subdomain",
        targetEmail: faculty.email.toLowerCase(),
        updateEmail: false,
      };
    }
    return {
      action: "flag_subdomain_mismatch",
      reason: `Email subdomain "${parsed.subdomain}" differs from CSV code "${expectedSubdomain}"`,
      targetEmail,
      updateEmail: true,
    };
  }

  if (parsed.kind === "other") {
    return {
      action: "flag_other_domain",
      reason: `Unexpected email domain "${parsed.domain}"`,
      targetEmail,
      updateEmail: true,
    };
  }

  return {
    action: "flag_invalid",
    reason: "Invalid or missing email",
    targetEmail,
    updateEmail: false,
  };
};

const run = async () => {
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║   Faculty Department + Email Update (CSV)       ║");
  console.log("╚══════════════════════════════════════════════════╝");
  if (DRY_RUN) console.log("  🔍 DRY-RUN — no database writes");
  if (FORCE) console.log("  ⚡ FORCE — will also rewrite plain @iitd.ac.in emails");
  console.log("");

  if (!fs.existsSync(inputFile)) {
    err(`Input file not found: ${inputFile}`);
    err("Create a CSV with columns: kerberos_id, department_code");
    process.exit(1);
  }

  if (!process.env.MONGODB_URI) {
    err("MONGODB_URI not set in .env");
    process.exit(1);
  }

  let rows;
  try {
    rows = rowsFromCsv(inputFile);
  } catch (e) {
    err(e.message);
    process.exit(1);
  }

  log(`Loaded ${rows.length} rows from ${path.basename(inputFile)}`);
  console.log("");

  await mongoose.connect(process.env.MONGODB_URI);
  ok("Database connected\n");

  const { default: Faculty } = await import("../models/faculty.js");
  const { default: Department } = await import("../models/departments.js");

  const deptByCode = new Map(
    (await Department.find({}, "name code").lean()).map((d) => [
      String(d.code).toUpperCase(),
      d,
    ])
  );

  const stats = {
    updated: 0,
    skipped: 0,
    failed: 0,
    flagged: 0,
  };

  const flagged = [];
  const failures = [];
  const updates = [];

  for (const row of rows) {
    const label = `[line ${row.line}] ${row.kerberos} → ${row.departmentCode}`;

    if (!row.kerberos || !row.departmentCode) {
      warn(`${label} — skipped: missing kerberos or department_code`);
      stats.skipped++;
      failures.push({ ...row, reason: "missing kerberos or department_code" });
      continue;
    }

    const dept = deptByCode.get(row.departmentCode);
    if (!dept) {
      warn(`${label} — skipped: unknown department code "${row.departmentCode}"`);
      stats.skipped++;
      failures.push({
        ...row,
        reason: `unknown department code "${row.departmentCode}"`,
      });
      continue;
    }

    const faculty = await findFacultyByKerberos(Faculty, row.kerberos);
    if (!faculty) {
      warn(`${label} — skipped: no faculty with email prefix "${row.kerberos}"`);
      stats.skipped++;
      failures.push({ ...row, reason: "faculty not found" });
      continue;
    }

    const classification = classifyRow(faculty, row.departmentCode, FORCE);
    const needsFlag =
      classification.action === "flag_central" ||
      classification.action === "flag_subdomain_mismatch" ||
      classification.action === "flag_other_domain" ||
      classification.action === "flag_invalid";

    const facultyLabel = `${faculty.firstName} ${faculty.lastName} (${faculty.email})`;
    const currentDeptCode = faculty.department?.code?.toUpperCase?.() ?? "?";
    const deptMismatch = String(faculty.department?._id) !== String(dept._id);

    if (classification.action === "flag_invalid") {
      stats.flagged++;
      flagged.push({
        line: row.line,
        kerberos: row.kerberos,
        departmentCode: row.departmentCode,
        faculty: facultyLabel,
        currentEmail: faculty.email,
        currentDepartment: currentDeptCode,
        action: classification.action,
        reason: classification.reason,
        proposedEmail: faculty.email,
      });
      warn(`${label} — FLAGGED: ${classification.reason}`);
      warn(`          Faculty: ${facultyLabel}`);
      if (deptMismatch) {
        warn("          Skipping: invalid email — department not updated");
      }
      continue;
    }

    const willUpdateEmail =
      classification.updateEmail &&
      classification.targetEmail !== faculty.email.toLowerCase();

    if (needsFlag) {
      stats.flagged++;
      flagged.push({
        line: row.line,
        kerberos: row.kerberos,
        departmentCode: row.departmentCode,
        faculty: facultyLabel,
        currentEmail: faculty.email,
        currentDepartment: currentDeptCode,
        action: classification.action,
        reason: classification.reason,
        proposedEmail: willUpdateEmail ? classification.targetEmail : faculty.email,
        proposedDepartment: row.departmentCode,
        willUpdateDepartment: deptMismatch,
        willUpdateEmail,
      });
      warn(`${label} — FLAGGED: ${classification.reason}`);
      warn(`          Faculty: ${facultyLabel}`);
      if (classification.action === "flag_central" && !FORCE) {
        warn("          Department will still update if mismatched; email needs --force");
      }
    }

    const payload = {};
    if (deptMismatch) {
      payload.department = dept._id;
    }
    if (willUpdateEmail) {
      payload.email = classification.targetEmail;
    }

    const changeParts = [];
    if (payload.department) {
      changeParts.push(`dept ${currentDeptCode} → ${row.departmentCode}`);
    }
    if (payload.email) {
      changeParts.push(`email ${faculty.email} → ${payload.email}`);
    }

    if (changeParts.length === 0) {
      log(`${label} — no changes needed (${facultyLabel})`);
      continue;
    }

    updates.push({
      line: row.line,
      kerberos: row.kerberos,
      faculty: facultyLabel,
      changes: changeParts.join("; "),
    });

    if (DRY_RUN) {
      log(`[DRY-RUN] Would update ${label}: ${changeParts.join("; ")}`);
      stats.updated++;
      continue;
    }

    try {
      await Faculty.updateOne({ _id: faculty._id }, { $set: payload });
      ok(`UPDATED ${label}: ${changeParts.join("; ")}`);
      stats.updated++;
    } catch (e) {
      err(`FAILED ${label} — ${e.message}`);
      stats.failed++;
      failures.push({ ...row, faculty: facultyLabel, reason: e.message });
    }
  }

  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║                     Summary                      ║");
  console.log("╠══════════════════════════════════════════════════╣");
  console.log(`║  Rows in CSV     : ${String(rows.length).padEnd(29)}║`);
  console.log(`║  ✅ Updated      : ${String(stats.updated).padEnd(29)}║`);
  console.log(`║  ⚠️  Flagged      : ${String(stats.flagged).padEnd(28)}║`);
  console.log(`║  ⏭  Skipped      : ${String(stats.skipped).padEnd(29)}║`);
  console.log(`║  ❌ Failed       : ${String(stats.failed).padEnd(29)}║`);
  console.log("╚══════════════════════════════════════════════════╝");

  const reportDir = path.join(__dirname, "../../data");
  if (flagged.length > 0) {
    const flagPath = path.join(reportDir, "dept-update-flagged.json");
    fs.writeFileSync(flagPath, JSON.stringify(flagged, null, 2));
    console.log(`\n  Flagged rows saved to: data/dept-update-flagged.json`);
    console.log(
      "  (Plain @iitd.ac.in = likely central IITD; dept still updates, use --force for email)"
    );
  }

  if (failures.length > 0) {
    const failPath = path.join(reportDir, "dept-update-errors.json");
    fs.writeFileSync(failPath, JSON.stringify(failures, null, 2));
    console.log(`  Errors saved to: data/dept-update-errors.json`);
  }

  if (DRY_RUN && updates.length > 0) {
    console.log("\n  Planned updates:");
    updates.forEach((u) => console.log(`    • ${u.kerberos}: ${u.changes}`));
  }

  await mongoose.disconnect();
  console.log("\n  🔌 Disconnected. Done.\n");
};

run().catch((e) => {
  err(`Unhandled error: ${e.message}`);
  console.error(e);
  process.exit(1);
});
