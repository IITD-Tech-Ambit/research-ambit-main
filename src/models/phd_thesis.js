import mongoose from "mongoose";



const PhdThesisSchema = new mongoose.Schema({
    document_id: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    link: {
        type: String,
    },
    publication_year: {
        type: Number,
        index: true
    },
    document_type: {
        type: String,
        required: true,
        index: true
    },
    title: {
        type: String,
        required: true
    },
    abstract: {
        type: String,
    },
    field_associated: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Department"
    },

    department_code: {
        type: String,
        index: true
    },
    department_name: {
        type: String,
    },
    subject_area: [{
        type: String,
    }],
    contributor: {
        author: {
            type: String,
            required: true
        },
        advisor: {
            name: {
                type: String,
            },
            matched_profile: {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Faculty"
            }
        }
    },
    open_search_id: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
});

// Compound and additional indexes
PhdThesisSchema.index({ "author.contributor": 1 });
PhdThesisSchema.index({ "author.advisor.name": 1 });
PhdThesisSchema.index({ "author.advisor.matched_profile": 1 });
PhdThesisSchema.index({ subject_area: 1 });
PhdThesisSchema.index({ title: "text" }); // Text index for full-text search
PhdThesisSchema.index({ publication_year: -1, document_type: 1 }); // Compound index for common queries



export default mongoose.model("PhdThesis", PhdThesisSchema);