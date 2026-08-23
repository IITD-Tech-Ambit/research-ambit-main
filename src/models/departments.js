import mongoose from "mongoose";


const departmentSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
    },
    code: {
        type: String,
        required: true,
        unique: true,
    },
    category: {
        type: String,
        enum: ['Department', 'School', 'Centre', 'Research Lab / Facility', 'Other'],
        default: 'Other',
    },
    // Former codes kept after a rename/merge so old citations still resolve.
    // The legacy Department document is never deleted.
    aliases: {
        type: [String],
        default: [],
    },
    // Soft-hide from public directory tabs. Document stays in the collection.
    hidden: {
        type: Boolean,
        default: false,
    },
    official_url: {
        type: String,
    },
})

departmentSchema.index({ name: 1 });
departmentSchema.index({ category: 1 });
departmentSchema.index({ hidden: 1 });

export default mongoose.model("Department", departmentSchema);