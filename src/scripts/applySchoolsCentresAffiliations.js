/**
 * Sync Schools & Centres membership from the IITD faculty PDF extract.
 *
 * Reads data/schools-centres-pdf.json (unit -> kerberos list) and:
 *   1. Creates missing school/centre Department docs (action: "create").
 *   2. Updates name/category of existing units (action: "update_existing").
 *   3. For every kerberos matched to a Faculty (by email local-part), adds the
 *      unit's Department _id to `affiliations` ($addToSet). The home
 *      `department` field is NEVER modified, so faculty stay listed under
 *      their department AND appear under the school/centre with the same
 *      profile.
 *
 * DRY RUN by default — prints the full plan and writes nothing.
 *
 * Usage:
 *   node src/scripts/applySchoolsCentresAffiliations.js             ← dry run
 *   node src/scripts/applySchoolsCentresAffiliations.js --apply     ← write
 *   node src/scripts/applySchoolsCentresAffiliations.js --file path/to.json
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Faculty from "../models/faculty.js";
import Department from "../models/departments.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const fileFlag = args.indexOf("--file");
const inputFile =
  fileFlag !== -1
    ? path.resolve(args[fileFlag + 1])
    : path.join(__dirname, "../../data/schools-centres-pdf.json");

const log = (msg) => console.log(`  ${msg}`);
const ok = (msg) => console.log(`  [ok] ${msg}`);
const warn = (msg) => console.warn(`  [!!] ${msg}`);

const kerberosOf = (email) =>
  typeof email === "string" && email.includes("@")
    ? email.split("@", 1)[0].trim().toLowerCase()
    : null;

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error("MONGODB_URI not set in .env");
    process.exit(1);
  }
  const { units } = JSON.parse(fs.readFileSync(inputFile, "utf-8"));

  console.log(`\n${APPLY ? "APPLY MODE — writing to DB" : "DRY RUN — no writes"}`);
  console.log(`Data file: ${inputFile} (${units.length} units)\n`);

  await mongoose.connect(process.env.MONGODB_URI);

  // Kerberos -> Faculty (one query, email local-part match done in JS).
  const allFaculty = await Faculty.find(
    {},
    "_id email firstName lastName department affiliations"
  ).lean();
  const byKerberos = new Map();
  for (const f of allFaculty) {
    const k = kerberosOf(f.email);
    if (k) byKerberos.set(k, f);
  }

  const allDepts = await Department.find({}, "_id code name category").lean();
  const deptByCode = new Map(allDepts.map((d) => [d.code, d]));
  const deptById = new Map(allDepts.map((d) => [String(d._id), d]));

  const stats = {
    unitsCreated: 0,
    unitsUpdated: 0,
    affiliationsAdded: 0,
    alreadyHome: 0,
    alreadyAffiliated: 0,
    missingKerberos: [],
  };

  for (const unit of units) {
    console.log(`\n=== [${unit.kind}] ${unit.pdfName} -> ${unit.code} ===`);
    let dept = deptByCode.get(unit.code);

    if (!dept && unit.action !== "create") {
      warn(`department code "${unit.code}" not found in DB — skipping unit`);
      continue;
    }

    if (!dept && unit.action === "create") {
      log(`CREATE department { code: "${unit.code}", name: "${unit.name}", category: "${unit.category}" }`);
      stats.unitsCreated++;
      if (APPLY) {
        dept = (
          await Department.create({ code: unit.code, name: unit.name, category: unit.category })
        ).toObject();
        deptByCode.set(dept.code, dept);
        deptById.set(String(dept._id), dept);
        ok(`created ${dept._id}`);
      }
    } else if (unit.action === "update_existing") {
      const changes = {};
      if (dept.name !== unit.name) changes.name = unit.name;
      if (dept.category !== unit.category) changes.category = unit.category;
      if (Object.keys(changes).length > 0) {
        log(`UPDATE ${unit.code}: ${JSON.stringify({ from: { name: dept.name, category: dept.category }, to: changes })}`);
        stats.unitsUpdated++;
        if (APPLY) {
          await Department.updateOne({ _id: dept._id }, { $set: changes });
          Object.assign(dept, changes);
          ok("updated");
        }
      } else {
        log("no metadata changes needed");
      }
    }

    if (!dept) {
      log(`(dry run) faculty adds below assume the unit gets created`);
    }

    for (const fac of unit.faculty) {
      const kerb = fac.kerberos.toLowerCase().trim();
      const dbFac = byKerberos.get(kerb);
      if (!dbFac) {
        stats.missingKerberos.push({ kerberos: kerb, name: fac.name, unit: unit.pdfName });
        continue;
      }

      // Resolve home department (tolerates code / stringified id storage).
      const rawDept = dbFac.department;
      const homeDept =
        deptById.get(String(rawDept)) || deptByCode.get(String(rawDept)) || null;

      if (dept && homeDept && String(homeDept._id) === String(dept._id)) {
        stats.alreadyHome++;
        continue; // already listed via home department
      }

      const hasAffiliation =
        dept &&
        (dbFac.affiliations || []).some((a) => String(a) === String(dept._id));
      if (hasAffiliation) {
        stats.alreadyAffiliated++;
        continue;
      }

      stats.affiliationsAdded++;
      log(
        `ADD affiliation: ${kerb} (${dbFac.firstName} ${dbFac.lastName}, ${dbFac.email}) -> ${unit.code}`
      );
      if (APPLY && dept) {
        await Faculty.updateOne(
          { _id: dbFac._id },
          { $addToSet: { affiliations: dept._id } }
        );
      }
    }
  }

  console.log("\n=== SUMMARY ===");
  console.log(`  units created:        ${stats.unitsCreated}`);
  console.log(`  units updated:        ${stats.unitsUpdated}`);
  console.log(`  affiliations to add:  ${stats.affiliationsAdded}`);
  console.log(`  already home dept:    ${stats.alreadyHome}`);
  console.log(`  already affiliated:   ${stats.alreadyAffiliated}`);
  console.log(`  kerberos not in DB:   ${stats.missingKerberos.length}`);
  for (const m of stats.missingKerberos) {
    console.log(`    - ${m.kerberos} (${m.name}) [${m.unit}]`);
  }
  if (!APPLY) {
    console.log("\nDry run only. Re-run with --apply to write these changes.");
  } else {
    console.log("\nDone. Remember directory responses are cached in Redis (dir:* keys, TTL ~3h).");
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
