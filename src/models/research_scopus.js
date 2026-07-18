import mongoose from "mongoose";


const AuthorSchema = new mongoose.Schema({
    author_id: {
        type: String,
        required: true,
    },
    author_position: {
        type: String,
    },
    author_name: {
        type: String,
        required: true
    },
    author_avaialable_names: [{
        type: String,
    }]
})

const ResearchMetaDataScopus = new mongoose.Schema({
    document_eid: {
        type: String,
        required: true,
        unique: true
    },
    document_scopus_id: {
        type: String,
        required: true,
        unique: true
    },
    link: {
        type: String,
    },
    publication_year: {
        type: Number,
    },
    document_type: {
        type: String,
    },
    citation_count: {
        type: Number,
    },
    reference_count: {
        type: Number,
    },
    title: {
        type: String,
        required: true
    },
    abstract: {
        type: String,
        required: true
    },
    field_associated: {
        type: String,
    },
    subject_area: [{
        type: String,
    }],
    authors: [AuthorSchema],
    kerberos: {
        // email prefix (lowercased) of the IITD faculty the paper is linked to.
        // Stamped by the OpenSearch ingest pipeline; used as a fallback link
        // when none of the paper's Scopus authors match Faculty.scopus_id.
        type: String,
    },
    open_search_id: {
        type: String,
        required: true,
        unique: true
    }
}, {
    timestamps: true
});

ResearchMetaDataScopus.index({
    publication_year: -1,
    field_associated: 1,
    document_type: 1
});

// Author-based queries (faculty publications: match authors.author_id +
// publication_year, sort citation_count — getFacultyPublications)
ResearchMetaDataScopus.index({ "authors.author_id": 1, publication_year: -1, citation_count: -1 });

ResearchMetaDataScopus.index({ subject_area: 1, publication_year: -1 });
ResearchMetaDataScopus.index({ citation_count: -1 });
ResearchMetaDataScopus.index(
    { title: "text", abstract: "text" },
    { weights: { title: 10, abstract: 1 }, name: "text_search_fallback" }
);

// Kerberos-based queries (faculty research summary / publications) — the
// trailing citation_count also covers getFacultyPublications' sort, not
// just the year-grouping in getFacultyResearchSummary.
ResearchMetaDataScopus.index({ kerberos: 1, publication_year: -1, citation_count: -1 });

export default mongoose.model("ResearchMetaDataScopus", ResearchMetaDataScopus);
