/**
 * Read-only audit for PDF rows whose kerberos did not match Faculty.email.
 *
 * These mappings were established by comparing the PDF name/unit with the DB
 * name, email and home department. This script verifies those assumptions and
 * reports which rows are already covered by the home unit versus which would
 * require a secondary affiliation. It never writes to MongoDB.
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
const outputFile = path.join(
  __dirname,
  "../../../.dev-local/skipped-faculty-name-match-audit.json"
);

const matches = [
  {
    pdfKerberos: "amanath",
    pdfName: "Maya Ramanath",
    dbEmail: "ramanath@cse.iitd.ac.in",
    homeCode: "cse",
    targetCodes: ["sit", "scai"],
  },
  {
    pdfKerberos: "rahulgarg",
    pdfName: "Rahul Garg",
    dbEmail: "rahul.garg@cse.iitd.ac.in",
    homeCode: "cse",
    targetCodes: ["sit", "nrcvee"],
  },
  {
    pdfKerberos: "kmayank",
    pdfName: "Mayank Kumar",
    dbEmail: "Mayank.Kumar@mech.iitd.ac.in",
    homeCode: "mech",
    targetCodes: ["sire"],
  },
  {
    pdfKerberos: "rakpandey",
    pdfName: "R.K. Pandey",
    dbEmail: "rajpandey@mech.iitd.ac.in",
    homeCode: "mech",
    targetCodes: ["sire"],
  },
  {
    pdfKerberos: "drskjha",
    pdfName: "Sandeep K. Jha",
    dbEmail: "sandeepjha@cbme.iitd.ac.in",
    homeCode: "cbme",
    targetCodes: ["sire", "cbme"],
  },
  {
    pdfKerberos: "arnab.chanda",
    pdfName: "Arnab Chanda",
    dbEmail: "arnabchanda@cbme.iitd.ac.in",
    homeCode: "cbme",
    targetCodes: ["sire", "cbme", "nrcvee"],
  },
  {
    pdfKerberos: "monika.makwana",
    pdfName: "Monika Makwana",
    dbEmail: "makwana92@sopp.iitd.ac.in",
    homeCode: "sopp",
    targetCodes: ["sopp"],
  },
  {
    pdfKerberos: "p pooja",
    pdfName: "Pooja Prasad",
    dbEmail: "p_pooja@sopp.iitd.ac.in",
    homeCode: "sopp",
    targetCodes: ["sopp"],
  },
  {
    pdfKerberos: "sanjay.mitra",
    pdfName: "Sanjay Mitra",
    dbEmail: "sanjaymitra@iitd.ac.in",
    homeCode: "sopp",
    targetCodes: ["sopp"],
  },
  {
    pdfKerberos: "gourab.ghatak",
    pdfName: "Gaurav Ghatak",
    dbEmail: "gghatak@ee.iitd.ac.in",
    homeCode: "ee",
    targetCodes: ["scai"],
  },
  {
    pdfKerberos: "lkumar",
    pdfName: "Lalan Kumar",
    dbEmail: "lalank@ee.iitd.ac.in",
    homeCode: "ee",
    targetCodes: ["scai", "nrcvee"],
  },
  {
    pdfKerberos: "san81",
    pdfName: "Sandeep Sukumaran",
    dbEmail: "sandeep.sukumaran@cas.iitd.ac.in",
    homeCode: "cas",
    targetCodes: ["scai", "cas"],
  },
  {
    pdfKerberos: "kilo",
    pdfName: "Kirill Klionovski",
    dbEmail: "klio@care.iitd.ac.in",
    homeCode: "care",
    targetCodes: ["care"],
  },
  {
    pdfKerberos: "hodetsc",
    pdfName: "Sourabh B Paul",
    dbEmail: "sbpaul@hss.iitd.ac.in",
    homeCode: "hss",
    targetCodes: ["etsc"],
  },
  {
    pdfKerberos: "shahid.malik",
    pdfName: "Shahid Malik",
    dbEmail: "smalik@sense.iitd.ernet.in",
    homeCode: "sense",
    targetCodes: ["sense"],
  },
  {
    pdfKerberos: "deepakjain9060",
    pdfName: "Deepak Jain",
    dbEmail: "jaindeepak@opc.iitd.ac.in",
    homeCode: "opc",
    targetCodes: ["opc"],
  },
  {
    pdfKerberos: "ajay.saini",
    pdfName: "Ajay Saini",
    dbEmail: "ajaysaini@rdat.iitd.ac.in",
    homeCode: "rdat",
    targetCodes: ["rdat"],
  },
];

if (!process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI not set");
}

await mongoose.connect(process.env.MONGODB_URI);

const allCodes = [
  ...new Set(matches.flatMap((item) => [item.homeCode, ...item.targetCodes])),
];
const departments = await Department.find(
  { code: { $in: allCodes } },
  "_id code name category"
).lean();
const departmentByCode = new Map(departments.map((item) => [item.code, item]));

const rows = [];
for (const match of matches) {
  const faculty = await Faculty.findOne(
    { email: new RegExp(`^${match.dbEmail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
    "_id firstName lastName email department affiliations"
  ).lean();

  if (!faculty) {
    rows.push({ ...match, verified: false, error: "DB faculty not found" });
    continue;
  }

  const home = departmentByCode.get(match.homeCode);
  const homeMatches =
    home && String(home._id) === String(faculty.department);
  const dbName = [faculty.firstName, faculty.lastName].filter(Boolean).join(" ");

  for (const targetCode of match.targetCodes) {
    const target = departmentByCode.get(targetCode);
    const alreadyHome =
      target && String(target._id) === String(faculty.department);
    const alreadyAffiliated =
      target &&
      (faculty.affiliations || []).some(
        (item) => String(item) === String(target._id)
      );

    rows.push({
      pdfKerberos: match.pdfKerberos,
      pdfName: match.pdfName,
      dbFacultyId: faculty._id,
      dbName,
      dbEmail: faculty.email,
      dbHomeDepartment: home
        ? { code: home.code, name: home.name, category: home.category }
        : null,
      expectedHomeCode: match.homeCode,
      homeDepartmentVerified: Boolean(homeMatches),
      target: target
        ? {
            id: target._id,
            code: target.code,
            name: target.name,
            category: target.category,
          }
        : null,
      alreadyHome: Boolean(alreadyHome),
      alreadyAffiliated: Boolean(alreadyAffiliated),
      wouldAddAffiliation: Boolean(
        target && homeMatches && !alreadyHome && !alreadyAffiliated
      ),
    });
  }
}

const report = {
  note: "READ-ONLY audit; no MongoDB writes were performed.",
  uniqueFaculty: matches.length,
  pdfRows: rows.length,
  verifiedRows: rows.filter(
    (row) => row.homeDepartmentVerified && row.target
  ).length,
  alreadyCoveredByHome: rows.filter((row) => row.alreadyHome).length,
  alreadyAffiliated: rows.filter((row) => row.alreadyAffiliated).length,
  proposedAffiliationAdds: rows.filter((row) => row.wouldAddAffiliation).length,
  rows,
};

fs.writeFileSync(outputFile, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, rows: undefined }, null, 2));
console.log(`Wrote ${outputFile}`);

await mongoose.disconnect();
