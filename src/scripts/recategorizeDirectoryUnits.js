/**
 * One-off directory category correction.
 *
 * Keeps the ten PDF centres, adds Computer Centre as the eleventh, and hides
 * three legacy centres from the Centres tab by categorizing them as Other.
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
import Department from "../models/departments.js";

dotenv.config();

if (!process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI not set");
}

await mongoose.connect(process.env.MONGODB_URI);

const changes = [
  { code: "ces", category: "Other" },
  { code: "iddc", category: "Other" },
  { code: "itmmec", category: "Other" },
  { code: "cc", category: "Centre" },
];

for (const { code, category } of changes) {
  const department = await Department.findOne({ code }, "name code category");
  if (!department) {
    throw new Error(`Department code not found: ${code}`);
  }

  const previousCategory = department.category;
  department.category = category;
  await department.save();
  console.log(`${code}: ${previousCategory} -> ${category} (${department.name})`);
}

await mongoose.disconnect();
