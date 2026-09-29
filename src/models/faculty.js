import mongoose from 'mongoose'

const facultySchema = new mongoose.Schema({
    expert_id:{
        type:String,
        required:true,
        unique:true
    },
    experience_id:{
        type:String,
        required:true,
        unique:true
    },
    qualification_id:{
        type:String,
    },
    title:{
        type:String,
        required:true
    },
    firstName:{
        type:String,
        required:true
    },
    lastName:{
        type:String,
        required:true
    },
    email:{
        type:String,
        required:true,
    },
    gender:{
        type:String,
        enum:['Male','Female','Other'],
        required:true
    },
    department:{
        type:mongoose.Schema.Types.ObjectId,
        ref:'Department',
        required:true
    },
    // Secondary units (Schools / Centres) the faculty also belongs to.
    // `department` stays the home department; the directory lists the same
    // faculty (same profile) under every unit in department ∪ affiliations.
    affiliations:[{
        type:mongoose.Schema.Types.ObjectId,
        ref:'Department'
    }],
    profile_image_url:{
        type:String,
    },
    // Per-metric visibility, controlled by the faculty member. When false, the
    // metric is hidden from ALL public views (profile, directory, chatbot) but
    // the underlying value stays in the DB so it can be shown again later.
    // A missing field / missing key means visible (default true).
    metric_visibility:{
        h_index:{ type:Boolean, default:true },
        citations:{ type:Boolean, default:true },
        papers:{ type:Boolean, default:true },
        patents:{ type:Boolean, default:true },
    },
    // Optional profile-only sections the faculty can add and choose to show.
    // Hidden by default; the content is kept in the DB even when hidden so it can
    // be shown again. Only exposed on the /faculty/:kerberos/profile page —
    // never in directory search/listings. Validation (>=100 chars background,
    // >=1 qualification) is enforced on the write ONLY when the section is shown.
    background:{
        type:String,
    },
    qualifications:{
        type:[String],
        default:[],
    },
    background_visible:{
        type:Boolean,
        default:false,
    },
    qualifications_visible:{
        type:Boolean,
        default:false,
    },
    // Awards & Honors — faculty-managed, same show/hide model as qualifications.
    awards:{
        type:[String],
        default:[],
    },
    awards_visible:{
        type:Boolean,
        default:false,
    },
    // Faculty-added research areas. Shown ALONGSIDE the auto-computed
    // dominant_domains, but rendered as plain (non-clickable) text since they
    // don't map to a taxonomy domain slug. The faculty can add/remove only
    // these — never the computed dominant_domains.
    custom_research_areas:{
        type:[String],
        default:[],
    },
    // Extra contact emails the faculty chooses to list. The primary `email`
    // (kerberos) is the DB key and is never stored/removed here.
    additional_emails:{
        type:[String],
        default:[],
    },
    // Contact number + office address, each independently show/hide-able.
    phone:{
        type:String,
    },
    phone_visible:{
        type:Boolean,
        default:false,
    },
    office_address:{
        type:String,
    },
    office_address_visible:{
        type:Boolean,
        default:false,
    },
    // Faculty-defined external links (personal site, lab page, LinkedIn, ORCID,
    // anything) — each has a faculty-chosen label. Shown alongside the existing
    // Scopus / Google Scholar links. Content is kept even while hidden.
    external_links:{
        type:[{
            label:{ type:String, default:"" },
            url:{ type:String, required:true },
            _id:false,
        }],
        default:[],
    },
    external_links_visible:{
        type:Boolean,
        default:false,
    },
    designation:{
        type:String,
    },
    // Public directory listing flag. "emeritus" hides the person from the
    // default roster; the Faculty document is never deleted.
    directory_status:{
        type:String,
        enum:['active','emeritus'],
        default:'active',
    },
    working_from_year:{
        type:Number,
    },
    expertise_id:{
        type:"String",
    },
    subject:{
        type:String,
    },
    h_index:{
        type:Number,
    },
    citation_count:{
        type:Number,
    },
    wos_subjects:[String],
    expertise:[String],
    brief_expertise:[String],
    subjects:[String],

    // Precomputed dominant taxonomy Domains for this faculty, written once by
    // SEO-Backend-iitd's scripts/taxonomy/populateFacultyDomains.js against
    // this same collection. Declared here too so this schema (a separate
    // Mongoose model over the same `faculties` collection) actually returns
    // the field on read.
    dominant_domains: [{
        domain_id: { type: mongoose.Schema.Types.ObjectId },
        name: String,
        slug: String,
        paper_count: Number,
        _id: false
    }],
    dominant_domains_updated_at: { type: Date },

    orcid_id:[String],
    researcher_id:[String],
    google_scholar_id:[String],
    scopus_id:[String]
}, {
    timestamps: true
});

facultySchema.index({ 
    firstName: 'text', 
    lastName: 'text', 
    expertise: 'text', 
    brief_expertise: 'text',
    subjects: 'text',
    wos_subjects: 'text'
}, {
    name: 'faculty_text_search_index',
    weights: {
        firstName: 10,
        lastName: 10,
        expertise: 5,
        brief_expertise: 5,
        subjects: 3,
        wos_subjects: 3
    }
});

facultySchema.index({ department: 1 });
facultySchema.index({ affiliations: 1 });
facultySchema.index({ firstName: 1, lastName: 1 });
facultySchema.index({ email: 1 });

// search-api (opensearch service) does $in lookups on scopus_id on every
// search-result hydration — was previously unindexed, forcing a collection
// scan on Faculty's hottest read path from that service.
facultySchema.index({ scopus_id: 1 });

// Directory listing sorts on these — without an index, getAllFaculties'
// $sort had to scan+sort the whole collection before paginating.
facultySchema.index({ h_index: -1, _id: 1 });
facultySchema.index({ citation_count: -1, _id: 1 });

export default mongoose.model('Faculty', facultySchema);