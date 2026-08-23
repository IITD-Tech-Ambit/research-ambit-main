import dotenv from "dotenv";
import mongoose from "mongoose";
import Faculty from "../models/faculty.js";
import Department from "../models/departments.js";

dotenv.config();
await mongoose.connect(process.env.MONGODB_URI);

const codes = [
  "iddc", "sense", "itmmec", "cart", "ces", "dese",
  "civil", "cc", "bstm", "admin", "fitt", "iitd",
];
const depts = await Department.find(
  { code: { $in: codes } },
  "code name category hidden aliases official_url"
).lean();

for (const d of depts) {
  const faculty = await Faculty.collection.countDocuments({
    $or: [
      { department: d._id },
      { department: String(d._id) },
      { department: d.code },
      { affiliations: d._id },
    ],
  });
  console.log({
    code: d.code,
    name: d.name,
    category: d.category,
    hidden: !!d.hidden,
    aliases: d.aliases || [],
    faculty,
  });
}

console.log("totals", {
  faculty: await Faculty.countDocuments(),
  departments: await Department.countDocuments(),
});

await mongoose.disconnect();
