import mongoose from "mongoose";


const PhdThesisSchema = new mongoose.Schema({

    department: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Department",
        required: true
    },
    dc_contributor_advisor: { type: [String] },
    dc_contributor_author: { type: [String] },
    dc_date_accessioned: { type: Date },
    dc_date_created: { type: Date },
    dc_date_issued: { type: Date },
    dc_description_provenance_en: { type: String },
    dc_identifier_citation: { type: String },
    dc_identifier_uri: { type: String },
    dc_language_iso: { type: String },
    dc_publisher: { type: String },
    dc_relation_ispartofseries: { type: String },
    dc_subject: { type: [String] },
    dc_title: { type: String },
    dc_type: { type: String },
    open_search_id: { type: String, required: true, unique: true },
});
// Indexes
PhdThesisSchema.index({ department: 1, dc_date_issued: -1 });
PhdThesisSchema.index({ dc_contributor_author: 1 });
PhdThesisSchema.index({ dc_contributor_advisor: 1 });
PhdThesisSchema.index({ dc_subject: 1 });
PhdThesisSchema.index({ dc_title: "text" });


export default mongoose.model("PhdThesis", PhdThesisSchema);