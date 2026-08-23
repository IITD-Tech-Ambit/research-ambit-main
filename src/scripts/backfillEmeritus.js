/**
 * Tag likely emeritus/retired faculty. NEVER deletes documents.
 *
 * Conservative: only tag faculty whose designation already says Emeritus
 * or Retired. The generic-@iitd.ac.in heuristic is too noisy (it would hide
 * sitting HODs). Sets directory_status only. designation is left unchanged.
 *
 *   node src/scripts/backfillEmeritus.js
 *   node src/scripts/backfillEmeritus.js --apply
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
import Faculty from "../models/faculty.js";

dotenv.config();

const APPLY = process.argv.includes("--apply");
function looksEmeritus(value) {
  const text = String(value || "");
  // Still-active chairs (e.g. SERB National Science Chair) stay on the default list.
  if (/national science chair|serb/i.test(text)) return false;
  return /emeritus|retired/i.test(text);
}

await mongoose.connect(process.env.MONGODB_URI);

const candidates = await Faculty.find(
  {
    $or: [{ directory_status: { $exists: false } }, { directory_status: { $ne: "emeritus" } }],
  },
  "firstName lastName email designation directory_status"
).lean();

const toTag = candidates.filter((f) => looksEmeritus(f.designation));

console.log(APPLY ? "APPLY MODE — no deletes" : "DRY RUN — no writes");
console.log(`Will tag ${toTag.length} faculty as emeritus (documents kept)\n`);
for (const f of toTag) {
  console.log(`  ${f.firstName} ${f.lastName} <${f.email}>`);
}

if (APPLY && toTag.length) {
  const result = await Faculty.updateMany(
    { _id: { $in: toTag.map((f) => f._id) } },
    { $set: { directory_status: "emeritus" } }
  );
  console.log(`\nTagged ${result.modifiedCount} faculty. None deleted.`);
} else if (!APPLY) {
  console.log("\nDry run only. Re-run with --apply to write directory_status.");
}

await mongoose.disconnect();
