import { asyncErrorHandler } from "../middleware/errorHandler.js";
import { successResponse } from "../lib/responseUtils.js";
import { BadRequestError } from "../lib/customErrors.js";
import mongoose from "mongoose";
import Faculty from "../models/faculty.js";
import Department from "../models/departments.js";
import research_scopus from "../models/research_scopus.js";
import { getScholarResearchBlock } from "../utils/fetchScholarData.js";
import { ensureRedisConnected, redisClient } from "../lib/redis.js";

let directory = {};

const CACHE_TTL_S = parseInt(process.env.FACULTY_CACHE_TTL_S) || 10800;

const tryRedisGet = async (key) => {
    try {
        if (!(await ensureRedisConnected())) return null;
        return await redisClient.get(key);
    } catch { return null; }
};

const tryRedisSetEx = async (key, ttl, value) => {
    try {
        if (!(await ensureRedisConnected())) return;
        await redisClient.setEx(key, ttl, value);
    } catch { /* fail-open */ }
};

const sendCachedJson = async (res, cacheKey, buildPayload) => {
    const cached = await tryRedisGet(cacheKey);
    if (cached) {
        res.setHeader("X-Cache", "HIT");
        return res.status(200).json(JSON.parse(cached));
    }
    const payload = await buildPayload();
    await tryRedisSetEx(cacheKey, CACHE_TTL_S, JSON.stringify(payload));
    res.setHeader("X-Cache", "MISS");
    return res.status(200).json(payload);
};

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

    // Sort/paginate on bare Faculty docs first (index-backed), then only
    // run the department $lookup against the page actually returned —
    // this used to lookup+unwind the whole collection before paginating,
    // which meant every page turned into a full collection scan+join.
    const pipeline = [
        { $sort: { [sortField]: sortOrder, _id: 1 } },
        { $skip: skip },
        { $limit: limit },
        departmentLookupStage,
        { $unwind: "$department" },
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
    const category = String(req.query.category ?? "all").trim().toLowerCase() || "all";
    const summaryOnly = req.query.summaryOnly === "true";
    const cacheKey = `dir:grouped:${summaryOnly ? "summary" : "full"}:${category}`;

    return sendCachedJson(res, cacheKey, async () => {
        const matchStage = buildGroupedCategoryMatch(category === "all" ? undefined : category);

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
            return {
                success: true,
                message: "Grouped department summary fetched successfully",
                data: {
                    departments: groupedDataRaw,
                    totalDepartments: groupedDataRaw.length,
                    totalFaculty: groupedDataRaw.reduce((sum, d) => sum + d.stats.totalFaculty, 0)
                },
                timestamp: new Date().toISOString(),
            };
        }

        const groupedData = await formatGroupedFaculties(groupedDataRaw);

        return {
            success: true,
            message: "Grouped faculties fetched successfully",
            data: {
                departments: groupedData,
                totalDepartments: groupedData.length,
                totalFaculty: groupedData.reduce((sum, d) => sum + d.stats.totalFaculty, 0)
            },
            timestamp: new Date().toISOString(),
        };
    });
});

directory.getFacultiesForDepartmentGroup = asyncErrorHandler(async (req, res) => {
    const { departmentId } = req.params;
    const category = String(req.query.category ?? "all").trim().toLowerCase() || "all";

    if (!departmentId || !mongoose.Types.ObjectId.isValid(String(departmentId))) {
        throw new BadRequestError("Valid department id is required");
    }

    const cacheKey = `dir:grouped:dept:${category}:${departmentId}`;

    return sendCachedJson(res, cacheKey, async () => {
        const categoryMatch = buildGroupedCategoryMatch(category === "all" ? undefined : category);
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

        return {
            success: true,
            message: "Department faculties fetched successfully",
            data: { faculties },
            timestamp: new Date().toISOString(),
        };
    });
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

/**
 * Batch-resolve kerberos ids → IITD Faculty profiles, for pages that receive
 * kerberos lists (e.g. taxonomy browse) and render faculty cards in one round trip.
 * Body: { kerberosIds: string[] } (max 100)
 * Response: { matches: { [kerberos: string]: DirectoryFaculty } }
 * Missing ids are simply absent from the map.
 */
directory.resolveFacultiesByKerberos = asyncErrorHandler(async (req, res) => {
    const raw = Array.isArray(req.body?.kerberosIds) ? req.body.kerberosIds : [];
    const ids = [...new Set(
        raw
            .map((v) => (v == null ? "" : String(v).trim().toLowerCase()))
            .filter((v) => v.length > 0)
    )].slice(0, 100);

    if (ids.length === 0) {
        return successResponse(res, { matches: {} }, "No kerberos ids provided", 200);
    }

    const faculties = await Faculty.find({
        email: { $in: ids.map((k) => new RegExp("^" + escapeRegex(k) + "@", "i")) }
    }).lean();
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
        const kerberos = String(faculty.email || "").split("@")[0].toLowerCase();
        if (ids.includes(kerberos)) {
            matches[kerberos] = formatDirectoryFaculty(faculty, subjectMap, { department });
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

directory.getFacultyByKerberos = asyncErrorHandler(async (req, res) => {
    const { kerberos } = req.params;
    if (!kerberos || !kerberos.trim()) {
        throw new BadRequestError("Kerberos id is required");
    }
    const k = kerberos.trim().toLowerCase();
    const escaped = escapeRegex(k);
    const faculty = await Faculty.findOne({ email: new RegExp('^' + escaped + '@', 'i') }).lean();
    if (!faculty) {
        throw new BadRequestError("Faculty not found for this kerberos");
    }

    const department = await findDepartmentByReference(faculty.department);
    const { kerberosIds: fkKids, expertIdToKerberos: fkE2k, expertIdToScopusIds: fkS2k } = collectKerberosInfo([faculty]);
    const subjectMap = await buildSubjectAreaMap(fkKids, fkE2k, fkS2k);
    const facultyResponse = formatDirectoryFaculty(faculty, subjectMap, { department });

    return successResponse(res, facultyResponse, "Faculty fetched successfully", 200);
});

const resolveFacultyByKerberos = async (kerberos) => {
    const escaped = escapeRegex(kerberos);
    return Faculty.findOne({ email: new RegExp('^' + escaped + '@', 'i') }).lean();
};

const buildPapersMatch = (kerberos, scopusIds) => {
    const clauses = [];
    if (kerberos) clauses.push({ kerberos });
    if (scopusIds.length) clauses.push({ "authors.author_id": { $in: scopusIds } });
    if (!clauses.length) return { document_eid: { $in: [] } };
    return clauses.length === 1 ? clauses[0] : { $or: clauses };
};

directory.getFacultyResearchSummary = asyncErrorHandler(async (req, res) => {
    const { kerberos } = req.params;
    if (!kerberos || !kerberos.trim()) {
        throw new BadRequestError("Kerberos id is required");
    }
    const k = kerberos.trim().toLowerCase();
    const yearLimit = Math.min(20, Math.max(1, parseInt(req.query.yearLimit) || 5));
    const yearOffset = Math.max(0, parseInt(req.query.yearOffset) || 0);

    const cacheKey = `summary:${k}:${yearOffset}:${yearLimit}`;
    const cached = await tryRedisGet(cacheKey);
    if (cached) {
        return res.status(200).json(JSON.parse(cached));
    }

    const faculty = await resolveFacultyByKerberos(k);
    if (!faculty) {
        throw new BadRequestError("Faculty not found for this kerberos");
    }

    const displayName = [faculty.title, faculty.firstName, faculty.lastName]
        .filter(Boolean).join(" ").replace(/\s+/g, " ").trim();

    const scopusIds = (faculty.scopus_id || []).map(String).filter(Boolean);

    // Scholar fallback for faculty without scopus data
    if (scopusIds.length === 0) {
        const scholarBlock = await getScholarResearchBlock(faculty);
        if (scholarBlock) {
            const timelineMap = new Map();
            const scholarPapers = Array.isArray(scholarBlock.papers) ? scholarBlock.papers : [];
            for (const p of scholarPapers) {
                if (!p.year) continue;
                if (!timelineMap.has(p.year)) timelineMap.set(p.year, []);
                timelineMap.get(p.year).push(p);
            }
            const allYears = [...timelineMap.entries()]
                .sort((a, b) => b[0] - a[0])
                .map(([year, papers]) => ({
                    year,
                    count: papers.length,
                    papers: papers
                        .sort((a, b) => (b.citations || 0) - (a.citations || 0))
                        .slice(0, 3)
                        .map((p) => ({
                            title: p.title || "",
                            type: p.type || "Publication",
                            citations: p.citations || 0,
                            link: p.url || null,
                            document_scopus_id: null,
                            authors: (Array.isArray(p.authors) ? p.authors : []).map((n) => ({
                                name: typeof n === "string" ? n : n?.author_name || "",
                                author_id: "",
                                matched_profile: null,
                            })),
                        })),
                }));

            const totalYears = allYears.length;
            const timeline = allYears.slice(yearOffset, yearOffset + yearLimit);

            const payload = {
                success: true,
                message: "Research summary fetched successfully",
                data: {
                    faculty: { name: displayName, _id: faculty._id },
                    source: "scholar",
                    hIndex: faculty.h_index ?? scholarBlock.hIndex ?? 0,
                    citationCount: faculty.citation_count ?? scholarBlock.citationCount ?? 0,
                    scopusId: undefined,
                    stats: { totalPapers: scholarPapers.length, totalYears },
                    timeline,
                    yearOffset,
                    yearLimit,
                },
                timestamp: new Date().toISOString(),
            };
            await tryRedisSetEx(cacheKey, CACHE_TTL_S, JSON.stringify(payload));
            return res.status(200).json(payload);
        }
    }

    const papersMatch = buildPapersMatch(k, scopusIds);

    const [aggResult] = await research_scopus.aggregate([
        { $match: papersMatch },
        {
            $facet: {
                timeline: [
                    {
                        $project: {
                            title: 1,
                            publication_year: 1,
                            document_type: 1,
                            citation_count: 1,
                            link: 1,
                            document_scopus_id: 1,
                            "authors.author_name": 1,
                            "authors.author_id": 1,
                            "authors.matched_profile": 1,
                        },
                    },
                    { $sort: { publication_year: -1, citation_count: -1 } },
                    {
                        $group: {
                            _id: "$publication_year",
                            count: { $sum: 1 },
                            papers: {
                                $push: {
                                    title: "$title",
                                    type: "$document_type",
                                    citations: "$citation_count",
                                    link: "$link",
                                    document_scopus_id: "$document_scopus_id",
                                    authors: "$authors",
                                },
                            },
                        },
                    },
                    { $sort: { _id: -1 } },
                    {
                        $project: {
                            _id: 0,
                            year: "$_id",
                            count: 1,
                            papers: { $slice: ["$papers", 3] },
                        },
                    },
                ],
                stats: [{ $count: "totalPapers" }],
                yearCount: [
                    { $group: { _id: "$publication_year" } },
                    { $count: "total" },
                ],
            },
        },
    ]);

    const allTimelineYears = (aggResult?.timeline || []).filter((y) => y.year != null);
    const totalYears = aggResult?.yearCount?.[0]?.total ?? allTimelineYears.length;
    const paginatedYears = allTimelineYears.slice(yearOffset, yearOffset + yearLimit);

    const timeline = paginatedYears.map((y) => ({
        year: y.year,
        count: y.count,
        papers: (y.papers || []).map((p) => ({
            title: p.title || "",
            type: p.type || "Publication",
            citations: p.citations ?? 0,
            link: p.link || null,
            document_scopus_id: p.document_scopus_id || null,
            authors: (p.authors || []).map((a) => ({
                name: a.author_name || "",
                author_id: a.author_id || "",
                matched_profile: a.matched_profile || null,
            })),
        })),
    }));

    const totalPapers = aggResult?.stats?.[0]?.totalPapers ?? 0;

    const payload = {
        success: true,
        message: "Research summary fetched successfully",
        data: {
            faculty: { name: displayName, _id: faculty._id },
            source: "scopus",
            hIndex: faculty.h_index ?? 0,
            citationCount: faculty.citation_count ?? 0,
            scopusId: pickPrimaryIdentifier(faculty.scopus_id),
            stats: { totalPapers, totalYears },
            timeline,
            yearOffset,
            yearLimit,
        },
        timestamp: new Date().toISOString(),
    };

    await tryRedisSetEx(cacheKey, CACHE_TTL_S, JSON.stringify(payload));
    return res.status(200).json(payload);
});

directory.getFacultyPublications = asyncErrorHandler(async (req, res) => {
    const { kerberos } = req.params;
    const year = parseInt(req.query.year);
    const skip = Math.max(0, parseInt(req.query.skip) || 0);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));

    if (!kerberos || !kerberos.trim()) {
        throw new BadRequestError("Kerberos id is required");
    }
    if (!year || isNaN(year)) {
        throw new BadRequestError("Valid year query param is required");
    }

    const k = kerberos.trim().toLowerCase();

    const cacheKey = `pubs:${k}:${year}:${skip}:${limit}`;
    const cached = await tryRedisGet(cacheKey);
    if (cached) {
        return res.status(200).json(JSON.parse(cached));
    }

    const faculty = await resolveFacultyByKerberos(k);
    if (!faculty) {
        throw new BadRequestError("Faculty not found for this kerberos");
    }

    const scopusIds = (faculty.scopus_id || []).map(String).filter(Boolean);
    const papersMatch = buildPapersMatch(k, scopusIds);

    const matchStage = { ...papersMatch, publication_year: year };

    const [papers, countResult] = await Promise.all([
        research_scopus.aggregate([
            { $match: matchStage },
            {
                $project: {
                    title: 1,
                    publication_year: 1,
                    document_type: 1,
                    citation_count: 1,
                    link: 1,
                    document_scopus_id: 1,
                    "authors.author_name": 1,
                    "authors.author_id": 1,
                    "authors.matched_profile": 1,
                },
            },
            { $sort: { citation_count: -1 } },
            { $skip: skip },
            { $limit: limit },
        ]),
        research_scopus.countDocuments(matchStage),
    ]);

    const formattedPapers = papers.map((p) => ({
        title: p.title || "",
        type: p.document_type || "Publication",
        citations: p.citation_count ?? 0,
        link: p.link || null,
        document_scopus_id: p.document_scopus_id || null,
        authors: (p.authors || []).map((a) => ({
            name: a.author_name || "",
            author_id: a.author_id || "",
            matched_profile: a.matched_profile || null,
        })),
    }));

    const payload = {
        success: true,
        message: "Publications fetched successfully",
        data: { year, total: countResult, papers: formattedPapers, skip, limit },
        timestamp: new Date().toISOString(),
    };

    await tryRedisSetEx(cacheKey, CACHE_TTL_S, JSON.stringify(payload));
    return res.status(200).json(payload);
});




export default directory;
