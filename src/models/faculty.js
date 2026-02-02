import mongoose from "mongoose";
const facultySchema = new mongoose.Schema({

    name: {
        type: String,
        required: true,
    },
    department: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Department",
        required: true
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },
    citationCount: {
        type: Number,
        default: 0
    },
    hIndex: {
        type: Number,
        default: 0
    },
    research_areas: {
        type: [String],
        default: []
    },
    orcId: {
        type: String,
    },
    scopusId: {
        type: String,
    }
});

// === INDEXES ===
facultySchema.index({ department: 1 });
facultySchema.index({ name: 1 });
facultySchema.index({ name: 'text' }); // Text index for search

export default mongoose.model("Faculty", facultySchema);