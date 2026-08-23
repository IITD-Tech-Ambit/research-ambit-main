/**
 * Soft-merge stale IIT Delhi unit names onto their current units.
 *
 * NEVER deletes Department or Faculty documents. Legacy units stay in
 * `departments` as hidden + category Other; faculty.department / affiliations
 * are retagged onto the surviving unit; old codes are stored as aliases.
 *
 * DRY RUN by default — prints the plan and writes nothing.
 *
 *   node src/scripts/mergeDirectoryUnits.js
 *   node src/scripts/mergeDirectoryUnits.js --apply
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
import Faculty from "../models/faculty.js";
import Department from "../models/departments.js";

dotenv.config();

const APPLY = process.argv.includes("--apply");

const MERGES = [
  {
    fromCode: "iddc",
    toCode: "sense",
    toName: "Centre for Sensors, Instrumentation and Cyber-physical Systems Engineering (SeNSE)",
    officialUrl: "https://sense.iitd.ac.in/",
  },
  {
    fromCode: "itmmec",
    toCode: "cart",
    officialUrl: "https://cart.iitd.ac.in/",
  },
  {
    fromCode: "ces",
    toCode: "dese",
    officialUrl: "https://dese.iitd.ac.in/",
  },
];

const RENAMES = [
  {
    code: "civil",
    name: "Department of Civil & Environmental Engineering",
    officialUrl: "https://civil.iitd.ac.in/",
  },
  {
    code: "cc",
    name: "Computer Services Centre (CSC)",
    officialUrl: "https://csc.iitd.ac.in/",
  },
];

const ENSURE_UNITS = [
  {
    code: "sit",
    name: "Amar Nath and Shashi Khosla School of Information Technology",
    category: "School",
    officialUrl: "https://sit.iitd.ac.in/",
  },
  {
    code: "bstm",
    name: "Bharti School of Telecommunication Technology and Management",
    category: "School",
    officialUrl: "https://bhartischool.iitd.ac.in/",
  },
  {
    code: "sire",
    name: "School of Interdisciplinary Research",
    category: "School",
    officialUrl: "https://sire.iitd.ac.in/",
  },
  {
    code: "etsc",
    name: "Educational Technology Services Centre",
    category: "Centre",
    officialUrl: "https://etsc.iitd.ac.in/",
  },
  {
    code: "nrcvee",
    name: "National Resource Centre for Value Education in Engineering",
    category: "Centre",
    officialUrl: "https://nrcvee.iitd.ac.in/",
  },
];

const HIDE_NAME_MATCHES = [
  /^administration$/i,
  /foundation for innovation/i,
  /^indian institute of technology delhi$/i,
];

const TRIPP_CODE = "tripp";

const log = (msg) => console.log(`  ${msg}`);
const ok = (msg) => console.log(`  [ok] ${msg}`);
const warn = (msg) => console.warn(`  [!!] ${msg}`);

function refStrings(dept) {
  return [String(dept._id), dept.code].filter(Boolean);
}

function matchesUnit(raw, dept) {
  if (raw == null) return false;
  const s = String(raw);
  return s === String(dept._id) || s === dept.code;
}

function facultyTouches(faculty, dept) {
  if (matchesUnit(faculty.department, dept)) return true;
  return (faculty.affiliations || []).some((a) => matchesUnit(a, dept));
}

function homeIs(faculty, dept) {
  return matchesUnit(faculty.department, dept);
}

async function hideLegacyUnit(from) {
  const set = { category: "Other", hidden: true };
  const alreadyHidden = from.hidden === true && from.category === "Other";
  if (alreadyHidden) {
    log(`legacy ${from.code} already hidden — leave document in place`);
    return;
  }
  log(`HIDE ${from.code} (${from.name}) → category=Other hidden=true  [document kept]`);
  if (APPLY) {
    await Department.updateOne({ _id: from._id }, { $set: set });
    Object.assign(from, set);
    ok("hidden (not deleted)");
  }
}

async function retagFaculty(faculty, from, to) {
  const name = `${faculty.firstName} ${faculty.lastName}`.trim();
  const wasHome = homeIs(faculty, from);
  const action = wasHome
    ? `MOVE home ${from.code} → ${to.code}`
    : `SWAP affiliation ${from.code} → ${to.code}`;
  log(`${action}: ${name} <${faculty.email}>`);

  if (!APPLY) return;

  const oldRefs = new Set(refStrings(from));
  if (wasHome) {
    await Faculty.updateOne({ _id: faculty._id }, [
      {
        $set: {
          department: to._id,
          affiliations: {
            $filter: {
              input: { $ifNull: ["$affiliations", []] },
              as: "a",
              cond: { $not: { $in: [{ $toString: "$$a" }, [...oldRefs]] } },
            },
          },
        },
      },
    ]);
  } else {
    await Faculty.updateOne({ _id: faculty._id }, [
      {
        $set: {
          affiliations: {
            $setUnion: [
              {
                $filter: {
                  input: { $ifNull: ["$affiliations", []] },
                  as: "a",
                  cond: { $not: { $in: [{ $toString: "$$a" }, [...oldRefs]] } },
                },
              },
              [to._id],
            ],
          },
        },
      },
    ]);
  }
}

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error("MONGODB_URI not set in .env");
    process.exit(1);
  }

  console.log(`\n${APPLY ? "APPLY MODE — writing (no deletes)" : "DRY RUN — no writes"}`);
  console.log("Safety: this script never calls deleteOne / deleteMany / drop.\n");

  await mongoose.connect(process.env.MONGODB_URI);

  const allDepts = await Department.find({}).lean();
  const deptByCode = new Map(allDepts.map((d) => [d.code, d]));
  const allFaculty = await Faculty.find(
    {},
    "_id email firstName lastName department affiliations"
  ).lean();

  const stats = {
    facultyRetagged: 0,
    unitsHidden: 0,
    unitsRenamed: 0,
    unitsCreated: 0,
    aliasesAdded: 0,
  };

  for (const merge of MERGES) {
    console.log(`\n=== MERGE ${merge.fromCode} → ${merge.toCode} (keep ${merge.fromCode} doc) ===`);
    const from = deptByCode.get(merge.fromCode);
    const to = deptByCode.get(merge.toCode);
    if (!from) {
      warn(`source unit "${merge.fromCode}" not found — skip`);
      continue;
    }
    if (!to) {
      warn(`target unit "${merge.toCode}" not found — skip`);
      continue;
    }

    const touched = allFaculty.filter((f) => facultyTouches(f, from));
    log(`${touched.length} faculty currently on ${from.code} (${from.name})`);

    for (const faculty of touched) {
      stats.facultyRetagged++;
      await retagFaculty(faculty, from, to);
    }

    const targetSet = {};
    if (merge.toName && to.name !== merge.toName) targetSet.name = merge.toName;
    if (merge.officialUrl && to.official_url !== merge.officialUrl) {
      targetSet.official_url = merge.officialUrl;
    }
    if (Object.keys(targetSet).length > 0) {
      log(`UPDATE ${to.code}: ${JSON.stringify(targetSet)}`);
      if (APPLY) {
        await Department.updateOne({ _id: to._id }, { $set: targetSet });
        Object.assign(to, targetSet);
        ok("target metadata updated");
      }
    }

    const hasAlias = (to.aliases || []).includes(from.code);
    if (!hasAlias) {
      log(`ALIAS ${to.code} += ${from.code}`);
      stats.aliasesAdded++;
      if (APPLY) {
        await Department.updateOne({ _id: to._id }, { $addToSet: { aliases: from.code } });
        ok("alias stored on surviving unit");
      }
    }

    stats.unitsHidden++;
    await hideLegacyUnit(from);
  }

  console.log("\n=== RENAMES (same document, new display name) ===");
  for (const rename of RENAMES) {
    const dept = deptByCode.get(rename.code);
    if (!dept) {
      warn(`rename target "${rename.code}" not found — skip`);
      continue;
    }
    const set = {};
    if (dept.name !== rename.name) set.name = rename.name;
    if (rename.officialUrl && dept.official_url !== rename.officialUrl) {
      set.official_url = rename.officialUrl;
    }
    if (Object.keys(set).length === 0) {
      log(`${rename.code}: already "${dept.name}"`);
      continue;
    }
    log(`${rename.code}: "${dept.name}" → ${JSON.stringify(set)}`);
    stats.unitsRenamed++;
    if (APPLY) {
      await Department.updateOne({ _id: dept._id }, { $set: set });
      Object.assign(dept, set);
      ok("renamed (same _id)");
    }
  }

  console.log("\n=== ENSURE MISSING UNITS (insert only) ===");
  for (const unit of ENSURE_UNITS) {
    const existing = deptByCode.get(unit.code);
    if (existing) {
      log(`${unit.code} already exists (${existing.name}) — leave as-is`);
      continue;
    }
    log(`CREATE { code: "${unit.code}", name: "${unit.name}", category: "${unit.category}" }`);
    stats.unitsCreated++;
    if (APPLY) {
      const created = await Department.create({
        code: unit.code,
        name: unit.name,
        category: unit.category,
        official_url: unit.officialUrl,
        hidden: false,
        aliases: [],
      });
      deptByCode.set(unit.code, created.toObject());
      ok(`inserted ${created._id}`);
    }
  }

  const tripp = deptByCode.get(TRIPP_CODE);
  if (tripp && tripp.category !== "Centre") {
    console.log("\n=== TRIPP category ===");
    log(`${tripp.code}: ${tripp.category} → Centre`);
    if (APPLY) {
      await Department.updateOne({ _id: tripp._id }, { $set: { category: "Centre" } });
      ok("TRIPP recategorized as Centre");
    }
  }

  console.log("\n=== HIDE NON-ACADEMIC BUCKETS (documents kept) ===");
  for (const dept of allDepts) {
    if (!HIDE_NAME_MATCHES.some((re) => re.test(dept.name))) continue;
    if (dept.hidden === true && dept.category === "Other") {
      log(`${dept.code} (${dept.name}) already hidden`);
      continue;
    }
    stats.unitsHidden++;
    await hideLegacyUnit(dept);
  }

  console.log("\n=== SUMMARY ===");
  console.log(`  faculty retagged:     ${stats.facultyRetagged}`);
  console.log(`  units hidden:         ${stats.unitsHidden}  (not deleted)`);
  console.log(`  units renamed:        ${stats.unitsRenamed}`);
  console.log(`  units created:        ${stats.unitsCreated}`);
  console.log(`  aliases added:        ${stats.aliasesAdded}`);
  if (!APPLY) {
    console.log("\nDry run only. Re-run with --apply to write these changes.");
  } else {
    console.log("\nDone. No documents were deleted.");
    console.log("Clear directory cache: node src/scripts/clearDirectoryCache.js");
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
