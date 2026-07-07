/**
 * Faculty-directory domain logic: formatting, department resolution, and the
 * aggregation building blocks shared by directoryController's endpoints.
 * Pure domain/data-shaping code — no req/res, no HTTP concerns.
 */
import Department from "../models/departments.js";
import research_scopus from "../models/research_scopus.js";

export const MAX_RESEARCH_AREAS = 8;

export const kerberosFromEmail = (email) => {
    if (!email || typeof email !== 'string') return null;
    const prefix = email.split('@')[0]?.trim().toLowerCase();
    return prefix || null;
};

export const pickPrimaryIdentifier = (value) => {
    if (Array.isArray(value)) {
        return value.find((item) => typeof item === "string" && item.trim().length > 0) || undefined;
    }
    return typeof value === "string" && value.trim().length > 0 ? value : undefined;
};

// Query-param category tag -> DB category string. Single source of truth —
// deriveDepartmentTags below derives its reverse mapping from this instead
// of duplicating the category list in a separate if/else chain.
export const DIRECTORY_CATEGORY_MAP = {
    departments: "Department",
    schools: "School",
    centres: "Centre",
    researchlabs: "Research Lab / Facility"
};

const CATEGORY_TO_TAG = Object.fromEntries(
    Object.entries(DIRECTORY_CATEGORY_MAP).map(([tag, category]) => [category, tag])
);

export const deriveDepartmentTags = (department) => {
    const tags = ["all"];
    const tag = department?.category && CATEGORY_TO_TAG[department.category];
    if (tag) tags.push(tag);
    return tags;
};

export const buildGroupedCategoryMatch = (category) => {
    const dbCategory = category && DIRECTORY_CATEGORY_MAP[category];
    return dbCategory ? { "department.category": dbCategory } : {};
};

export const normalizeDepartment = (department) => {
    if (!department) return null;
    return {
        _id: department._id,
        name: department.name,
        code: department.code,
        category: department.category
    };
};

export const buildSubjectAreaMap = async (kerberosIds = [], expertIdToKerberos = new Map(), expertIdToScopusIds = new Map()) => {
    if (expertIdToKerberos.size === 0 && expertIdToScopusIds.size === 0) {
        return new Map();
    }

    // Two parallel aggregations: one by kerberos, one by scopus author_id
    const allScopusIds = [...new Set([...expertIdToScopusIds.values()].flat())];

    const [kerberosCounts, scopusCounts] = await Promise.all([
        kerberosIds.length > 0
            ? research_scopus.aggregate([
                { $match: { kerberos: { $in: kerberosIds } } },
                { $unwind: { path: "$subject_area", preserveNullAndEmptyArrays: false } },
                { $group: { _id: { kerberos: "$kerberos", subject: "$subject_area" }, count: { $sum: 1 } } }
            ])
            : [],
        allScopusIds.length > 0
            ? research_scopus.aggregate([
                { $match: { "authors.author_id": { $in: allScopusIds } } },
                { $unwind: { path: "$authors", preserveNullAndEmptyArrays: false } },
                { $match: { "authors.author_id": { $in: allScopusIds } } },
                { $unwind: { path: "$subject_area", preserveNullAndEmptyArrays: false } },
                { $group: { _id: { authorId: "$authors.author_id", subject: "$subject_area" }, count: { $sum: 1 } } }
            ])
            : []
    ]);

    // Reverse maps
    const kerberosToExpertId = new Map();
    for (const [expertId, k] of expertIdToKerberos) kerberosToExpertId.set(k, expertId);
    const scopusToExpertId = new Map();
    for (const [expertId, sids] of expertIdToScopusIds) {
        for (const sid of sids) scopusToExpertId.set(sid, expertId);
    }

    // Merge into expert_id -> subject -> count
    const expertSubjectMap = new Map();
    const addSubject = (expertId, subject, count) => {
        if (!expertSubjectMap.has(expertId)) expertSubjectMap.set(expertId, new Map());
        const subjects = expertSubjectMap.get(expertId);
        subjects.set(subject, Math.max(subjects.get(subject) || 0, count));
    };

    for (const { _id, count } of kerberosCounts) {
        const subject = _id?.subject?.trim();
        if (!subject) continue;
        const eid = kerberosToExpertId.get(_id.kerberos);
        if (eid) addSubject(eid, subject, count);
    }
    for (const { _id, count } of scopusCounts) {
        const subject = _id?.subject?.trim();
        if (!subject) continue;
        const eid = scopusToExpertId.get(_id.authorId);
        if (eid) addSubject(eid, subject, count);
    }

    const subjectMap = new Map();
    for (const [expertId, subjectCounts] of expertSubjectMap) {
        const sorted = [...subjectCounts.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([subject]) => subject)
            .slice(0, MAX_RESEARCH_AREAS);
        subjectMap.set(expertId, sorted);
    }

    return subjectMap;
};

export const mergeResearchAreas = (facultyDoc, subjectMap) => {
    const buckets = [
        facultyDoc.expertise,
        facultyDoc.brief_expertise,
        facultyDoc.subjects,
        facultyDoc.wos_subjects,
        subjectMap.get(facultyDoc.expert_id)
    ];
    const seen = new Set();
    const ordered = [];
    buckets.forEach((bucket) => {
        if (!Array.isArray(bucket)) return;
        bucket.forEach((entry) => {
            if (typeof entry !== "string") return;
            const cleaned = entry.trim();
            if (!cleaned) return;
            const key = cleaned.toLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            ordered.push(cleaned);
        });
    });
    return ordered.slice(0, MAX_RESEARCH_AREAS);
};

export const formatDirectoryFaculty = (facultyDoc, subjectMap, overrides = {}) => {
    if (!facultyDoc) return null;
    const department = overrides.department || facultyDoc.department || null;
    const nameParts = [facultyDoc.title, facultyDoc.firstName, facultyDoc.lastName].filter(Boolean);
    const name = nameParts.join(" ").replace(/\s+/g, " ").trim();

    return {
        _id: facultyDoc._id,
        name,
        email: facultyDoc.email || "",
        citationCount: facultyDoc.citation_count ?? 0,
        hIndex: facultyDoc.h_index ?? 0,
        research_areas: mergeResearchAreas(facultyDoc, subjectMap),
        orcId: pickPrimaryIdentifier(facultyDoc.orcid_id),
        scopusId: pickPrimaryIdentifier(facultyDoc.scopus_id),
        googleScholarId: pickPrimaryIdentifier(facultyDoc.google_scholar_id),
        department: normalizeDepartment(department),
        tags: deriveDepartmentTags(department),
        profileImageUrl: facultyDoc.profile_image_url || null,
        designation: facultyDoc.designation || null,
        workingFromYear: typeof facultyDoc.working_from_year === "number" ? facultyDoc.working_from_year : null
    };
};

/**
 * Collect kerberos IDs, scopus IDs, and build expert_id mappings
 * for use with buildSubjectAreaMap (dual kerberos + scopus strategy).
 */
export const collectKerberosInfo = (faculties = []) => {
    const kerberosIds = [];
    const expertIdToKerberos = new Map();
    const expertIdToScopusIds = new Map();
    const seen = new Set();
    faculties.forEach((faculty) => {
        const k = kerberosFromEmail(faculty?.email);
        if (k && !seen.has(k)) {
            seen.add(k);
            kerberosIds.push(k);
        }
        if (faculty?.expert_id) {
            if (k) expertIdToKerberos.set(faculty.expert_id, k);
            const sids = (faculty?.scopus_id || []).map(String).filter(Boolean);
            if (sids.length > 0) expertIdToScopusIds.set(faculty.expert_id, sids);
        }
    });
    return { kerberosIds, expertIdToKerberos, expertIdToScopusIds };
};

export const isPossibleObjectId = (value) => typeof value === "string" && /^[0-9a-fA-F]{24}$/.test(value);

export const findDepartmentByReference = async (reference) => {
    if (!reference) return null;
    // Populated / aggregated department document
    if (typeof reference === "object" && typeof reference.name === "string") {
        return reference;
    }
    if (typeof reference === "string") {
        const byCode = await Department.findOne({ code: reference }, "name code category").lean();
        if (byCode) return byCode;
        if (isPossibleObjectId(reference)) {
            return Department.findById(reference, "name code category").lean();
        }
        return null;
    }
    if (typeof reference === "object" && reference._id != null) {
        const innerId = String(reference._id);
        if (isPossibleObjectId(innerId)) {
            const dept = await Department.findById(innerId, "name code category").lean();
            if (dept) return dept;
        }
    }
    // Bare ObjectId from Faculty.findOne().lean() (no ._id property on the id itself)
    if (typeof reference === "object" && typeof reference.toString === "function") {
        const asStr = String(reference);
        if (isPossibleObjectId(asStr)) {
            return Department.findById(asStr, "name code category").lean();
        }
    }
    return null;
};

export const escapeRegex = (input = "") => input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const departmentLookupStage = {
    $lookup: {
        from: "departments",
        let: {
            departmentRef: "$department",
            departmentRefStr: { $toString: "$department" }
        },
        pipeline: [
            {
                $match: {
                    $expr: {
                        $or: [
                            { $eq: ["$code", "$$departmentRef"] },
                            { $eq: ["$code", "$$departmentRefStr"] },
                            { $eq: [{ $toString: "$_id" }, "$$departmentRefStr"] }
                        ]
                    }
                }
            }
        ],
        as: "department"
    }
};

const EMPTY_SUBJECT_MAP = new Map();

export const facultyCardProjectFields = {
    _id: 1,
    title: 1,
    firstName: 1,
    lastName: 1,
    email: 1,
    citation_count: 1,
    h_index: 1,
    expertise: 1,
    brief_expertise: 1,
    subjects: 1,
    wos_subjects: 1,
    profile_image_url: 1,
    designation: 1,
    "department._id": 1,
    "department.name": 1,
    "department.code": 1
};

export const facultyCardPushFields = {
    _id: "$_id",
    title: "$title",
    firstName: "$firstName",
    lastName: "$lastName",
    email: "$email",
    citation_count: "$citation_count",
    h_index: "$h_index",
    expertise: "$expertise",
    brief_expertise: "$brief_expertise",
    subjects: "$subjects",
    wos_subjects: "$wos_subjects",
    profile_image_url: "$profile_image_url",
    designation: "$designation"
};

export const formatDirectoryFacultyCards = (facultyDocs = [], departmentOverride = null) =>
    facultyDocs.map((facultyDoc) => {
        const formatted = formatDirectoryFaculty(
            facultyDoc,
            EMPTY_SUBJECT_MAP,
            { department: departmentOverride || facultyDoc.department }
        );
        return {
            _id: formatted._id,
            name: formatted.name,
            email: formatted.email,
            citationCount: formatted.citationCount,
            hIndex: formatted.hIndex,
            research_areas: formatted.research_areas,
            department: formatted.department,
            profileImageUrl: formatted.profileImageUrl,
            designation: formatted.designation
        };
    });

export const formatGroupedFaculties = async (groupedDataRaw) => {
    return groupedDataRaw.map((dept) => ({
        _id: dept._id,
        department: dept.department,
        stats: dept.stats,
        faculties: formatDirectoryFacultyCards(dept.faculties || [], dept.department)
    }));
};
