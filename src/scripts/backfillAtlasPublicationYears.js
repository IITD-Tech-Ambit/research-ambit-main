/**
 * Add publication year to atlas_points from researchmetadatascopus.
 *
 * Dry-run by default:
 *   node src/scripts/backfillAtlasPublicationYears.js
 *
 * Apply after reviewing counts:
 *   node src/scripts/backfillAtlasPublicationYears.js --apply
 *
 * Writes only research_ambit.atlas_points and its { version, year } index.
 */
import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

const APPLY = process.argv.includes("--apply");
const BATCH_SIZE = 1000;

if (!process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI is required");
}

await mongoose.connect(process.env.MONGODB_URI);

try {
  const db = mongoose.connection.db;
  const atlasPoints = db.collection("atlas_points");
  const research = db.collection("researchmetadatascopus");
  const meta = db.collection("atlas_meta");

  const active = await meta.findOne({ _id: "active" }, { projection: { version: 1 } });
  const version = active?.version;
  if (!version) throw new Error("No active atlas version found in atlas_meta");

  const pointCount = await atlasPoints.countDocuments({ version });
  let scanned = 0;
  let matched = 0;
  let withYear = 0;
  let missingPaper = 0;
  let missingYear = 0;
  let updated = 0;
  const yearCounts = new Map();

  const cursor = atlasPoints
    .find({ version }, { projection: { _id: 1, id: 1, year: 1 } })
    .batchSize(BATCH_SIZE);

  let batch = [];

  async function processBatch(rows) {
    const valid = [];
    for (const row of rows) {
      if (!mongoose.Types.ObjectId.isValid(row.id)) {
        missingPaper++;
        continue;
      }
      valid.push({ row, paperId: new mongoose.Types.ObjectId(row.id) });
    }

    const papers = await research
      .find(
        { _id: { $in: valid.map(({ paperId }) => paperId) } },
        { projection: { publication_year: 1 } },
      )
      .toArray();
    const yearById = new Map(
      papers.map((paper) => [String(paper._id), Number(paper.publication_year) || null]),
    );

    const operations = [];
    for (const { row, paperId } of valid) {
      if (!yearById.has(String(paperId))) {
        missingPaper++;
        continue;
      }
      matched++;
      const year = yearById.get(String(paperId));
      if (!Number.isInteger(year) || year < 1900 || year > 2200) {
        missingYear++;
        continue;
      }
      withYear++;
      yearCounts.set(year, (yearCounts.get(year) ?? 0) + 1);
      if (row.year !== year) {
        operations.push({
          updateOne: {
            filter: { _id: row._id, version },
            update: { $set: { year } },
          },
        });
      }
    }

    if (APPLY && operations.length) {
      const result = await atlasPoints.bulkWrite(operations, { ordered: false });
      updated += result.modifiedCount;
    } else {
      updated += operations.length;
    }
  }

  for await (const row of cursor) {
    batch.push(row);
    scanned++;
    if (batch.length >= BATCH_SIZE) {
      await processBatch(batch);
      batch = [];
    }
  }
  if (batch.length) await processBatch(batch);

  if (APPLY) {
    await atlasPoints.createIndex(
      { version: 1, year: 1 },
      { name: "atlas_point_version_year" },
    );
  }

  const recentYears = [...yearCounts.entries()]
    .sort((a, b) => b[0] - a[0])
    .slice(0, 10)
    .map(([year, count]) => `${year}:${count}`)
    .join(", ");

  console.log(`${APPLY ? "APPLY" : "DRY RUN"} complete`);
  console.log(`Active version: ${version}`);
  console.log(`Atlas points: ${pointCount}; scanned: ${scanned}`);
  console.log(`Matched papers: ${matched}; valid years: ${withYear}`);
  console.log(`Missing paper: ${missingPaper}; missing year: ${missingYear}`);
  console.log(`${APPLY ? "Updated" : "Would update"}: ${updated}`);
  console.log(`Recent year counts: ${recentYears}`);
} finally {
  await mongoose.disconnect();
}
