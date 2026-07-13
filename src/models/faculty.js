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
    profile_image_url:{
        type:String,
    },
    designation:{
        type:String,
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