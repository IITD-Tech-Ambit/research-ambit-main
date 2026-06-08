import { asyncErrorHandler } from "../middleware/errorHandler.js";
import { successResponse } from "../lib/responseUtils.js";
import { BadRequestError } from "../lib/customErrors.js";
import mongoose from "mongoose";
import Faculty from "../models/faculty.js";
import Department from "../models/departments.js";
import research_scopus from "../models/research_scopus.js";
import { papersMongoFilterForFaculty } from "../utils/researchFacultyLink.js";
import phd_thesis from "../models/phd_thesis.js";
import { getScholarResearchBlock } from "../utils/fetchScholarData.js";

let directory = {};

const MAX_RESEARCH_AREAS = 8;

const kerberosFromEmail = (email) => {
    if (!email || typeof email !== 'string') return null;
    const prefix = email.split('@')[0]?.trim().toLowerCase();
    return prefix || null;
};

const pickPrimaryIdentifier = (value) => {
    if (Array.isArray(value)) {
        return value.find((item) => typeof item === "string" && item.trim().length > 0) || undefined;
    }
    return typeof value === "string" && value.trim().length > 0 ? value : undefined;
};

const deriveDepartmentTags = (department) => {
    const tags = ["all"];
    if (!department?.category) {
        return tags;
    }
    const category = department.category;
    if (category === "Department") tags.push("departments");
    else if (category === "School") tags.push("schools");
    else if (category === "Centre") tags.push("centres");
    else if (category === "Research Lab / Facility") tags.push("researchlabs");
    return tags;
};

const normalizeDepartment = (department) => {
    if (!department) return null;
    return {
        _id: department._id,
        name: department.name,
        code: department.code,
        category: department.category
    };
};

const buildSubjectAreaMap = async (kerberosIds = [], expertIdToKerberos = new Map(), expertIdToScopusIds = new Map()) => {
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

const mergeResearchAreas = (facultyDoc, subjectMap) => {
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

const formatDirectoryFaculty = (facultyDoc, subjectMap, overrides = {}) => {
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
const collectKerberosInfo = (faculties = []) => {
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

const isPossibleObjectId = (value) => typeof value === "string" && /^[0-9a-fA-F]{24}$/.test(value);

const findDepartmentByReference = async (reference) => {
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

const escapeRegex = (input = "") => input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeNameTokens = (value = "") =>
    value
        .split(/\s+/)
        .map((token) => token.replace(/[^a-zA-Z]/g, "").trim())
        .filter(Boolean);

const buildAdvisorNameRegexes = (faculty) => {
    const tokens = [];
    const pushTokens = (value) => {
        normalizeNameTokens(value).forEach((token) => {
            if (!tokens.includes(token)) {
                tokens.push(token);
            }
        });
    };

    pushTokens(faculty?.firstName);
    pushTokens(faculty?.lastName);

    if (tokens.length < 2) {
        pushTokens(faculty?.title);
    }

    if (tokens.length < 2 && faculty?.firstName && faculty?.lastName) {
        pushTokens(`${faculty.firstName} ${faculty.lastName}`);
    }

    if (!tokens.length && faculty?.name) {
        pushTokens(faculty.name);
    }

    if (!tokens.length) {
        return [];
    }

    const regexes = [];
    const lookaheadPattern = tokens
        .map((token) => `(?=.*\\b${escapeRegex(token)}\\b)`)
        .join("");
    regexes.push(new RegExp(lookaheadPattern, "i"));

    if (tokens.length >= 2) {
        const forward = tokens.map((token) => `\\b${escapeRegex(token)}\\b`).join("\\s+");
        regexes.push(new RegExp(`^${forward}$`, "i"));

        const reversed = [...tokens].reverse().map((token) => `\\b${escapeRegex(token)}\\b`).join("[\\s,]+");
        regexes.push(new RegExp(`^${reversed}$`, "i"));
    } else {
        regexes.push(new RegExp(`^\\b${escapeRegex(tokens[0])}\\b$`, "i"));
    }

    return regexes;
};

const dedupeByObjectId = (documents = []) => {
    const seen = new Set();
    return documents.filter((doc) => {
        const id = doc?._id?.toString?.();
        if (!id || seen.has(id)) {
            return false;
        }
        seen.add(id);
        return true;
    });
};

/**
 * Resolve a faculty's supervised PhD students from phd_thesis by advisor name /
 * matched profile. This is independent of the research-data source (Scopus or
 * Scholar) so both branches of getFacultyCoworking share it.
 */
const getSupervisedStudents = async (faculty) => {
    const advisorNameRegexes = buildAdvisorNameRegexes(faculty);
    const departmentCode = typeof faculty.department === "string"
        ? faculty.department
        : faculty.department?.code;

    const [thesesByProfile, thesesByName] = await Promise.all([
        phd_thesis.find({ "contributor.advisor.matched_profile": faculty._id }).lean(),
        advisorNameRegexes.length
            ? phd_thesis.find({
                ...(departmentCode ? { department_code: departmentCode } : {}),
                $or: advisorNameRegexes.map((regex) => ({ "contributor.advisor.name": regex }))
            }).lean()
            : Promise.resolve([])
    ]);

    const thesesWithFaculty = dedupeByObjectId([...thesesByProfile, ...thesesByName]);
    return thesesWithFaculty.map((thesis) => ({
        name: thesis.contributor?.author,
        affiliation: "IIT Delhi",
        thesis_title: thesis.title,
        year: thesis.publication_year || null
    }));
};

const departmentLookupStage = {
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

const facultyCardProjectFields = {
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

const formatDirectoryFacultyCards = (facultyDocs = [], departmentOverride = null) =>
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

directory.getAllFaculties = asyncErrorHandler(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 9));
    const skip = (page - 1) * limit;
    const sortBy = req.query.sortBy || "h_index";
    const sortOrder = req.query.order === "asc" ? 1 : -1;

    const sortFields = {
        name: "firstName",
        h_index: "h_index",
        hIndex: "h_index",
        citations: "citation_count",
        citation_count: "citation_count",
        citationCount: "citation_count"
    };
    const sortField = sortFields[sortBy] || "h_index";

    const pipeline = [
        departmentLookupStage,
        { $unwind: "$department" },
        { $sort: { [sortField]: sortOrder, _id: 1 } },
        { $skip: skip },
        { $limit: limit },
        { $project: facultyCardProjectFields }
    ];

    const [facultiesRaw, total] = await Promise.all([
        Faculty.aggregate(pipeline),
        Faculty.countDocuments()
    ]);

    const faculties = formatDirectoryFacultyCards(facultiesRaw);

    const totalPages = Math.ceil(total / limit);

    return successResponse(res, {
        data: faculties,
        pagination: {
            page,
            limit,
            total,
            totalPages,
            hasNext: page < totalPages,
            hasPrev: page > 1
        }
    }, "Faculties fetched successfully", 200);
});

const DIRECTORY_CATEGORY_MAP = {
    departments: "Department",
    schools: "School",
    centres: "Centre",
    researchlabs: "Research Lab / Facility"
};

const buildGroupedCategoryMatch = (category) => {
    const dbCategory = category && DIRECTORY_CATEGORY_MAP[category];
    return dbCategory ? { "department.category": dbCategory } : {};
};

const summaryDepartmentProjection = {
    _id: 1,
    department: {
        _id: "$department._id",
        name: "$department.name"
    },
    stats: {
        totalFaculty: "$totalFaculty"
    }
};

const facultyCardPushFields = {
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

const formatGroupedFaculties = async (groupedDataRaw) => {
    return groupedDataRaw.map((dept) => ({
        _id: dept._id,
        department: dept.department,
        stats: dept.stats,
        faculties: formatDirectoryFacultyCards(dept.faculties || [], dept.department)
    }));
};

directory.getFacultiesGroupedByDepartment = asyncErrorHandler(async (req, res) => {
    const category = req.query.category; // 'departments', 'schools', 'centres', 'researchlabs'
    const summaryOnly = req.query.summaryOnly === "true";

    const matchStage = buildGroupedCategoryMatch(category);

    const pipeline = [
        departmentLookupStage,
        { $unwind: "$department" },
        ...(Object.keys(matchStage).length > 0 ? [{ $match: matchStage }] : []),
        ...(summaryOnly ? [] : [{ $sort: { "department.name": 1, h_index: -1 } }]),
        {
            $group: {
                _id: "$department._id",
                department: {
                    $first: {
                        _id: "$department._id",
                        name: "$department.name"
                    }
                },
                ...(summaryOnly
                    ? {}
                    : { faculties: { $push: facultyCardPushFields } }),
                totalFaculty: { $sum: 1 },
                ...(summaryOnly ? {} : { avgHIndex: { $avg: "$h_index" } })
            }
        },
        { $sort: { "department.name": 1 } },
        {
            $project: summaryOnly
                ? summaryDepartmentProjection
                : {
                    _id: 1,
                    department: 1,
                    faculties: 1,
                    stats: {
                        totalFaculty: "$totalFaculty",
                        avgHIndex: { $round: ["$avgHIndex", 1] }
                    }
                }
        }
    ];

    const groupedDataRaw = await Faculty.aggregate(pipeline);

    if (summaryOnly) {
        return successResponse(res, {
            departments: groupedDataRaw,
            totalDepartments: groupedDataRaw.length,
            totalFaculty: groupedDataRaw.reduce((sum, d) => sum + d.stats.totalFaculty, 0)
        }, "Grouped department summary fetched successfully", 200);
    }

    const groupedData = await formatGroupedFaculties(groupedDataRaw);

    return successResponse(res, {
        departments: groupedData,
        totalDepartments: groupedData.length,
        totalFaculty: groupedData.reduce((sum, d) => sum + d.stats.totalFaculty, 0)
    }, "Grouped faculties fetched successfully", 200);
});

directory.getFacultiesForDepartmentGroup = asyncErrorHandler(async (req, res) => {
    const { departmentId } = req.params;
    const category = req.query.category;

    if (!departmentId || !mongoose.Types.ObjectId.isValid(String(departmentId))) {
        throw new BadRequestError("Valid department id is required");
    }

    const categoryMatch = buildGroupedCategoryMatch(category);
    const departmentObjectId = new mongoose.Types.ObjectId(String(departmentId));
    const facultiesRaw = await Faculty.aggregate([
        departmentLookupStage,
        { $unwind: "$department" },
        { $match: { "department._id": departmentObjectId, ...categoryMatch } },
        { $sort: { h_index: -1, _id: 1 } },
        { $project: facultyCardProjectFields }
    ]);

    if (facultiesRaw.length === 0) {
        throw new BadRequestError("Department not found");
    }

    const department = normalizeDepartment(facultiesRaw[0].department);
    const faculties = formatDirectoryFacultyCards(facultiesRaw, department);

    return successResponse(res, { faculties }, "Department faculties fetched successfully", 200);
});

directory.searchFaculties = asyncErrorHandler(async (req, res) => {
    const { q } = req.query;
    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit) || 10));

    if (!q || q.trim().length < 2) {
        return successResponse(res, {
            faculties: [],
            departments: [],
            total: 0
        }, "Search query too short", 200);
    }

    // 1. Tokenize: lowercase, trim, split by whitespace
    const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean);

    if (tokens.length === 0) {
        return successResponse(res, {
            faculties: [],
            departments: [],
            total: 0
        }, "Search query too short", 200);
    }

    // 2. Build per-token $and conditions on concatenated fullName
    const tokenMatchConditions = tokens.map((token) => ({
        fullName: { $regex: escapeRegex(token), $options: "i" }
    }));

    // 3. Build relevance scoring expressions
    const fullQuery = tokens.join(" ");
    const exactMatchExpr = {
        $cond: [
            { $regexMatch: { input: "$fullName", regex: `^${escapeRegex(fullQuery)}$`, options: "i" } },
            3,
            0
        ]
    };

    const wordBoundaryScoreExprs = tokens.map((token) => ({
        $cond: [
            { $regexMatch: { input: "$fullName", regex: `\\b${escapeRegex(token)}\\b`, options: "i" } },
            2,
            1
        ]
    }));

    const relevanceScoreExpr = {
        $add: [exactMatchExpr, ...wordBoundaryScoreExprs]
    };

    // 4. Primary search: token-based $and regex on fullName
    const primaryPipeline = [
        departmentLookupStage,
        { $unwind: "$department" },
        {
            $addFields: {
                fullName: {
                    $trim: {
                        input: {
                            $replaceAll: {
                                input: {
                                    $concat: [
                                        { $ifNull: ["$title", ""] }, " ",
                                        { $ifNull: ["$firstName", ""] }, " ",
                                        { $ifNull: ["$lastName", ""] }
                                    ]
                                },
                                find: "  ",
                                replacement: " "
                            }
                        }
                    }
                }
            }
        },
        { $match: { $and: tokenMatchConditions } },
        {
            $addFields: {
                relevanceScore: relevanceScoreExpr
            }
        },
        { $sort: { relevanceScore: -1, h_index: -1 } },
        { $limit: limit },
        {
            $project: {
                _id: 1,
                expert_id: 1,
                title: 1,
                firstName: 1,
                lastName: 1,
                email: 1,
                h_index: 1,
                citation_count: 1,
                expertise: 1,
                brief_expertise: 1,
                subjects: 1,
                wos_subjects: 1,
                orcid_id: 1,
                scopus_id: 1,
                profile_image_url: 1,
                designation: 1,
                working_from_year: 1,
                "department._id": 1,
                "department.name": 1,
                "department.code": 1,
                "department.category": 1
            }
        }
    ];

    // 5. Search departments by name (unchanged)
    const deptRegex = new RegExp(tokens.map(escapeRegex).join(".*"), "i");
    const departmentPromise = Department.find(
        { name: deptRegex },
        { name: 1, code: 1, category: 1 }
    ).limit(5);

    let [facultiesRaw, departments] = await Promise.all([
        Faculty.aggregate(primaryPipeline),
        departmentPromise
    ]);

    // 6. Fallback: if no regex results, try $text search for typo tolerance
    if (facultiesRaw.length === 0) {
        const textSearchPipeline = [
            { $match: { $text: { $search: q.trim() } } },
            { $addFields: { relevanceScore: { $meta: "textScore" } } },
            departmentLookupStage,
            { $unwind: "$department" },
            { $sort: { relevanceScore: -1, h_index: -1 } },
            { $limit: limit },
            {
                $project: {
                    _id: 1,
                    expert_id: 1,
                    title: 1,
                    firstName: 1,
                    lastName: 1,
                    email: 1,
                    h_index: 1,
                    citation_count: 1,
                    expertise: 1,
                    brief_expertise: 1,
                    subjects: 1,
                    wos_subjects: 1,
                    orcid_id: 1,
                    scopus_id: 1,
                    profile_image_url: 1,
                    designation: 1,
                    working_from_year: 1,
                    "department._id": 1,
                    "department.name": 1,
                    "department.code": 1,
                    "department.category": 1
                }
            }
        ];
        facultiesRaw = await Faculty.aggregate(textSearchPipeline);
    }

    const { kerberosIds: sKids, expertIdToKerberos: sE2k, expertIdToScopusIds: sS2k } = collectKerberosInfo(facultiesRaw);
    const subjectMap = await buildSubjectAreaMap(sKids, sE2k, sS2k);
    const faculties = facultiesRaw.map((faculty) => formatDirectoryFaculty(faculty, subjectMap));

    return successResponse(res, {
        faculties,
        departments,
        total: faculties.length + departments.length
    }, "Search completed", 200);
});

directory.getFacultyByScopusId = asyncErrorHandler(async (req, res) => {
    const { scopusId } = req.params;
    if (!scopusId || !String(scopusId).trim()) {
        throw new BadRequestError("No Scopus author id provided");
    }
    const sid = String(scopusId).trim();
    const faculty = await Faculty.findOne({ scopus_id: sid }).lean();
    if (!faculty) {
        throw new BadRequestError("Faculty not found for this Scopus id");
    }

    const department = await findDepartmentByReference(faculty.department);
    const { kerberosIds: bsKids, expertIdToKerberos: bsE2k, expertIdToScopusIds: bsS2k } = collectKerberosInfo([faculty]);
    const subjectMap = await buildSubjectAreaMap(bsKids, bsE2k, bsS2k);
    const facultyResponse = formatDirectoryFaculty(faculty, subjectMap, { department });

    return successResponse(res, facultyResponse, "Faculty fetched successfully", 200);
});

/**
 * Batch-resolve Scopus author ids → IITD Faculty profiles.
 * Body: { scopusIds: string[] }
 * Response: { matches: { [scopusId: string]: DirectoryFaculty } }
 * Missing ids are simply absent from the map.
 */
directory.resolveFacultiesByScopusIds = asyncErrorHandler(async (req, res) => {
    const raw = Array.isArray(req.body?.scopusIds) ? req.body.scopusIds : [];
    const ids = [...new Set(
        raw
            .map((v) => (v == null ? "" : String(v).trim()))
            .filter((v) => v.length > 0)
    )];

    if (ids.length === 0) {
        return successResponse(res, { matches: {} }, "No Scopus ids provided", 200);
    }

    const faculties = await Faculty.find({ scopus_id: { $in: ids } }).lean();
    if (faculties.length === 0) {
        return successResponse(res, { matches: {} }, "No matching faculty", 200);
    }

    const deptIds = faculties
        .map((f) => f.department)
        .filter(Boolean)
        .map((d) => (typeof d === "object" && d._id ? String(d._id) : String(d)))
        .filter((id) => isPossibleObjectId(id));
    const uniqueDeptIds = [...new Set(deptIds)];
    const departmentDocs = uniqueDeptIds.length
        ? await Department.find({ _id: { $in: uniqueDeptIds } }, "name code category").lean()
        : [];
    const departmentById = new Map(departmentDocs.map((d) => [String(d._id), d]));

    const { kerberosIds, expertIdToKerberos, expertIdToScopusIds } = collectKerberosInfo(faculties);
    const subjectMap = await buildSubjectAreaMap(kerberosIds, expertIdToKerberos, expertIdToScopusIds);

    const matches = {};
    for (const faculty of faculties) {
        const deptRef = faculty.department;
        let department = null;
        if (deptRef && typeof deptRef === "object" && typeof deptRef.name === "string") {
            department = deptRef;
        } else if (deptRef) {
            const key = typeof deptRef === "object" && deptRef._id ? String(deptRef._id) : String(deptRef);
            department = departmentById.get(key) || null;
        }
        const formatted = formatDirectoryFaculty(faculty, subjectMap, { department });
        for (const sid of faculty.scopus_id || []) {
            const key = String(sid).trim();
            if (ids.includes(key)) {
                matches[key] = formatted;
            }
        }
    }

    return successResponse(res, { matches }, "Resolved", 200);
});

directory.getFacultiesById = asyncErrorHandler(async (req, res) => {
    const { id } = req.params;
    if (!id) {
        throw new BadRequestError("No id provided");
    }
    const faculty = await Faculty.findById(id).lean();
    if (!faculty) {
        throw new BadRequestError("Faculty not found");
    }

    const department = await findDepartmentByReference(faculty.department);
    const { kerberosIds: fbKids, expertIdToKerberos: fbE2k, expertIdToScopusIds: fbS2k } = collectKerberosInfo([faculty]);
    const subjectMap = await buildSubjectAreaMap(fbKids, fbE2k, fbS2k);
    const facultyResponse = formatDirectoryFaculty(faculty, subjectMap, { department });

    return successResponse(res, facultyResponse, "Faculty fetched successfully", 200);
});

directory.getFacultyCoworking = asyncErrorHandler(async (req, res) => {
    const { id } = req.params;
    if (!id) {
        throw new BadRequestError("No id provided");
    }
    const faculty = await Faculty.findById(id).lean();
    if (!faculty) {
        throw new BadRequestError("Faculty not found");
    }

    const displayName = [faculty.title, faculty.firstName, faculty.lastName]
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

    // PhD students are resolved by advisor name and are independent of the
    // research-data source, so compute them once for both branches.
    const studentsFromThesis = await getSupervisedStudents(faculty);
    const studentStats = {
        totalStudentsSupervised: studentsFromThesis.length
    };

    const scopusIds = (faculty.scopus_id || [])
        .map(String)
        .filter((value) => value.trim().length > 0);

    // ── Fallback: faculty has no Scopus id → use Google Scholar ──
    // (faculty.scopus_id[0] vs faculty.google_scholar_id[0], per spec)
    if (scopusIds.length === 0) {
        const scholarBlock = await getScholarResearchBlock(faculty);
        if (scholarBlock) {
            // Persist Scholar-derived metrics back to the Faculty document so the
            // directory listing cards (which read stored h_index/citation_count)
            // reflect them without a live Scholar fetch per card. Fire-and-forget:
            // never block or fail the response on a cache-write error.
            const nextHIndex = scholarBlock.hIndex;
            const nextCitations = scholarBlock.citationCount;
            if (faculty.h_index !== nextHIndex || faculty.citation_count !== nextCitations) {
                Faculty.updateOne(
                    { _id: faculty._id },
                    { $set: { h_index: nextHIndex, citation_count: nextCitations } }
                ).catch((err) =>
                    console.error(`[scholar] failed to persist metrics for ${faculty._id}: ${err.message}`)
                );
            }

            return successResponse(res, {
                faculty: { name: displayName, _id: faculty._id },
                source: scholarBlock.source,
                hIndex: scholarBlock.hIndex,
                citationCount: scholarBlock.citationCount,
                scopusId: scholarBlock.scopusId,
                coworkersFromPapers: scholarBlock.coworkersFromPapers,
                studentsSupervised: studentsFromThesis,
                stats: {
                    totalPapers: scholarBlock.stats.totalPapers,
                    uniqueCoauthors: scholarBlock.stats.uniqueCoauthors,
                    ...studentStats
                },
                papers: scholarBlock.papers,
                coAuthors: scholarBlock.coAuthors,
                publicationTimeline: scholarBlock.publicationTimeline
            }, "Coworkers fetched successfully", 200);
        }
        // No Scholar id, or the Scholar fetch failed/was blocked → fall through
        // to the Scopus/kerberos path. With no scopus_id that query can still
        // match papers via the kerberos email link; if nothing matches the
        // response is a safe empty analytics payload.
    }

    // ── Scopus / kerberos path (existing behavior, unchanged) ──
    const scopusId = pickPrimaryIdentifier(faculty.scopus_id);
    const papersWithFaculty = await research_scopus.find(
        papersMongoFilterForFaculty(faculty)
    ).lean();
    const coworkersFromScopus = new Map();
    papersWithFaculty.forEach((paper) => {
        (paper.authors || []).forEach((author) => {
            // Skip entries with no name at all (not useful to show).
            if (!author?.author_name) return;
            // Skip this faculty's own entry (matched by scopus_id or by name).
            if (scopusId && author.author_id === scopusId) return;
            // Dedup key: use author_id when present (Scopus), else author_name (Scholar).
            const key = author.author_id || author.author_name;
            if (coworkersFromScopus.has(key)) return;
            coworkersFromScopus.set(key, {
                title: paper.title,
                publication_year: paper.publication_year,
                document_type: paper.document_type,
                subject_area: paper.subject_area || [],
                name: author.author_name,
                affiliation: author.author_affiliation || paper.field_associated || "External collaborator",
                author_id: author.author_id || "",
                matched_profile: author.matched_profile || null
            });
        });
    });

    const coworkersList = Array.from(coworkersFromScopus.values());

    // Normalized analytics (additive). Mirrors the Scholar payload so both
    // sources expose an identical response structure; existing UI ignores them.
    const normalizedPapers = papersWithFaculty.map((paper) => ({
        title: paper.title,
        year: paper.publication_year || null,
        citations: paper.citation_count ?? 0,
        type: paper.document_type || "Publication",
        venue: paper.field_associated || "",
        authors: (paper.authors || []).map((a) => a.author_name).filter(Boolean)
    }));
    const normalizedCoAuthors = coworkersList.map((c) => ({
        name: c.name,
        affiliation: c.affiliation,
        scholarId: ""
    }));
    const timelineMap = new Map();
    papersWithFaculty.forEach((paper) => {
        const year = paper.publication_year;
        if (!year) return;
        timelineMap.set(year, (timelineMap.get(year) || 0) + 1);
    });
    const normalizedTimeline = [...timelineMap.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([year, count]) => ({ year, count }));

    // Derive h_index + citation_count from papers and write back to Faculty doc
    // so directory cards show real values without requiring a re-run of backfill.
    if (papersWithFaculty.length > 0) {
        const counts = papersWithFaculty.map((p) => p.citation_count ?? 0);
        const derivedCitations = counts.reduce((s, c) => s + c, 0);
        const sortedCounts = [...counts].sort((a, b) => b - a);
        let derivedH = 0;
        for (let i = 0; i < sortedCounts.length; i++) {
            if (sortedCounts[i] >= i + 1) derivedH = i + 1;
            else break;
        }
        // Only write back if stored values differ to avoid unnecessary DB writes.
        if (faculty.h_index !== derivedH || faculty.citation_count !== derivedCitations) {
            Faculty.updateOne(
                { _id: faculty._id },
                { $set: { h_index: derivedH, citation_count: derivedCitations } }
            ).catch((err) =>
                console.error(`[scopus] failed to persist metrics for ${faculty._id}: ${err.message}`)
            );
        }
    }

    return successResponse(res, {
        faculty: {
            name: displayName,
            _id: faculty._id
        },
        source: "scopus",
        hIndex: faculty.h_index ?? 0,
        citationCount: faculty.citation_count ?? 0,
        scopusId,
        coworkersFromPapers: coworkersList,
        studentsSupervised: studentsFromThesis,
        stats: {
            totalPapers: papersWithFaculty.length,
            uniqueCoauthors: coworkersFromScopus.size,
            ...studentStats
        },
        papers: normalizedPapers,
        coAuthors: normalizedCoAuthors,
        publicationTimeline: normalizedTimeline
    }, "Coworkers fetched successfully", 200);
});




export default directory;
