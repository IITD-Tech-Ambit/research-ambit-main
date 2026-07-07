import crypto from "node:crypto";
import { asyncErrorHandler } from "../middleware/errorHandler.js";
import { successResponse } from "../lib/responseUtils.js";
import { BadRequestError } from "../lib/customErrors.js";
import mongoose from "mongoose";
import Faculty from "../models/faculty.js";
import Department from "../models/departments.js";
import research_scopus from "../models/research_scopus.js";
import { getScholarResearchBlock } from "../utils/fetchScholarData.js";
import { cacheGet, cacheSetEx } from "../lib/cache.js";
import {
    pickPrimaryIdentifier,
    normalizeDepartment,
    buildSubjectAreaMap,
    formatDirectoryFaculty,
    collectKerberosInfo,
    findDepartmentByReference,
    isPossibleObjectId,
    escapeRegex,
    departmentLookupStage,
    facultyCardProjectFields,
    facultyCardPushFields,
    formatDirectoryFacultyCards,
    formatGroupedFaculties,
    DIRECTORY_CATEGORY_MAP,
    buildGroupedCategoryMatch
} from "../domain/facultyDirectory.js";

let directory = {};

const CACHE_TTL_S = parseInt(process.env.FACULTY_CACHE_TTL_S) || 10800;

const sendCachedJson = async (res, cacheKey, buildPayload) => {
    const cached = await cacheGet(cacheKey);
    if (cached) {
        res.setHeader("X-Cache", "HIT");
        return res.status(200).json(JSON.parse(cached));
    }
    const payload = await buildPayload();
    await cacheSetEx(cacheKey, CACHE_TTL_S, JSON.stringify(payload));
    res.setHeader("X-Cache", "MISS");
    return res.status(200).json(payload);
};

directory.getAllFaculties = asyncErrorHandler(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 9));
    const sortBy = req.query.sortBy || "h_index";
    const order = req.query.order === "asc" ? "asc" : "desc";

    const cacheKey = `dir:list:${page}:${limit}:${sortBy}:${order}`;

    return sendCachedJson(res, cacheKey, async () => {
        const skip = (page - 1) * limit;
        const sortOrder = order === "asc" ? 1 : -1;

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

        return {
            success: true,
            message: "Faculties fetched successfully",
            data: {
                data: faculties,
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages,
                    hasNext: page < totalPages,
                    hasPrev: page > 1
                }
            },
            timestamp: new Date().toISOString(),
        };
    });
});

directory.getFacultiesGroupedByDepartment = asyncErrorHandler(async (req, res) => {
    const category = String(req.query.category ?? "all").trim().toLowerCase() || "all";
    const summaryOnly = req.query.summaryOnly === "true";
    const cacheKey = `dir:grouped:${summaryOnly ? "summary" : "full"}:${category}`;

    return sendCachedJson(res, cacheKey, async () => {
        if (summaryOnly) {
            // Group on the raw, unjoined `department` field first — a single cheap
            // pass over Faculty with no department join — then resolve only the
            // handful of distinct department references that came back (not all
            // 1,040 faculty rows) to their documents. Avoids the O(n×m) lookup+
            // unwind the non-summary path below needs for per-faculty fields.
            const rawGroups = await Faculty.aggregate([
                { $group: { _id: "$department", totalFaculty: { $sum: 1 } } }
            ]);

            const resolved = await Promise.all(
                rawGroups.map(async (g) => ({
                    totalFaculty: g.totalFaculty,
                    department: await findDepartmentByReference(g._id)
                }))
            );

            const categoryFilter = category !== "all" && DIRECTORY_CATEGORY_MAP[category];
            const merged = new Map();
            for (const { department, totalFaculty } of resolved) {
                if (!department) continue;
                if (categoryFilter && department.category !== categoryFilter) continue;
                const key = String(department._id);
                const existing = merged.get(key);
                if (existing) {
                    existing.stats.totalFaculty += totalFaculty;
                } else {
                    merged.set(key, {
                        _id: department._id,
                        department: { _id: department._id, name: department.name },
                        stats: { totalFaculty }
                    });
                }
            }

            const departments = [...merged.values()].sort((a, b) =>
                a.department.name.localeCompare(b.department.name)
            );

            return {
                success: true,
                message: "Grouped department summary fetched successfully",
                data: {
                    departments,
                    totalDepartments: departments.length,
                    totalFaculty: departments.reduce((sum, d) => sum + d.stats.totalFaculty, 0)
                },
                timestamp: new Date().toISOString(),
            };
        }

        // When filtering by category, resolve which departments match first (a
        // handful of docs, cheap) and match Faculty rows against them on the
        // indexed `department` field before joining — instead of joining the
        // whole Faculty collection and filtering on department.category after.
        const categoryDbValue = category !== "all" && DIRECTORY_CATEGORY_MAP[category];
        let preMatchStage = null;
        if (categoryDbValue) {
            const matchedDepartments = await Department.find({ category: categoryDbValue }, "_id code").lean();
            const values = [];
            for (const d of matchedDepartments) {
                values.push(d._id, String(d._id));
                if (d.code) values.push(d.code);
            }
            if (values.length === 0) {
                return {
                    success: true,
                    message: "Grouped faculties fetched successfully",
                    data: { departments: [], totalDepartments: 0, totalFaculty: 0 },
                    timestamp: new Date().toISOString(),
                };
            }
            preMatchStage = { $match: { department: { $in: values } } };
        }

        const pipeline = [
            ...(preMatchStage ? [preMatchStage] : []),
            departmentLookupStage,
            { $unwind: "$department" },
            { $sort: { "department.name": 1, h_index: -1 } },
            {
                $group: {
                    _id: "$department._id",
                    department: {
                        $first: {
                            _id: "$department._id",
                            name: "$department.name"
                        }
                    },
                    faculties: { $push: facultyCardPushFields },
                    totalFaculty: { $sum: 1 },
                    avgHIndex: { $avg: "$h_index" }
                }
            },
            { $sort: { "department.name": 1 } },
            {
                $project: {
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
        const departmentObjectId = new mongoose.Types.ObjectId(String(departmentId));
        const department = await Department.findById(departmentObjectId, "name code category").lean();
        if (!department) {
            throw new BadRequestError("Department not found");
        }
        const categoryMatch = buildGroupedCategoryMatch(category === "all" ? undefined : category);
        if (categoryMatch["department.category"] && categoryMatch["department.category"] !== department.category) {
            throw new BadRequestError("Department not found");
        }

        // Faculty.department is declared as an ObjectId, but some rows were
        // inserted with the department's code or its stringified id instead (the
        // same inconsistency departmentLookupStage's $expr works around) — match
        // all three forms directly against the indexed `department` field
        // instead of joining the whole collection first and filtering after.
        const departmentMatchClauses = [
            { department: departmentObjectId },
            { department: String(departmentObjectId) }
        ];
        if (department.code) departmentMatchClauses.push({ department: department.code });

        const facultiesRaw = await Faculty.aggregate([
            { $match: { $or: departmentMatchClauses } },
            { $sort: { h_index: -1, _id: 1 } },
            { $project: facultyCardProjectFields }
        ]);

        if (facultiesRaw.length === 0) {
            throw new BadRequestError("Department not found");
        }

        const normalizedDepartment = normalizeDepartment(department);
        const faculties = formatDirectoryFacultyCards(facultiesRaw, normalizedDepartment);

        return {
            success: true,
            message: "Department faculties fetched successfully",
            data: { faculties },
            timestamp: new Date().toISOString(),
        };
    });
});

// Batch-resolve endpoints are keyed by an arbitrary id set — hash the sorted,
// deduped ids so the cache key stays bounded regardless of batch size.
const batchCacheKey = (prefix, ids) => {
    const hash = crypto.createHash("sha256").update([...ids].sort().join(",")).digest("hex").slice(0, 16);
    return `dir:${prefix}:${hash}`;
};

// Short TTL relative to CACHE_TTL_S: search is keyed by free-typed query text,
// so cardinality is much higher than the other cached endpoints here — a long
// TTL would let Redis accumulate a huge number of rarely-reused keys.
const SEARCH_CACHE_TTL_S = 300;

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

    const cacheKey = `dir:search:${tokens.join(" ")}:${limit}`;
    const cached = await cacheGet(cacheKey);
    if (cached) {
        return res.status(200).json(JSON.parse(cached));
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
    // Match/score/sort/limit on bare Faculty docs first, then only run the
    // department $lookup against the page actually returned — this used to
    // join+unwind the whole collection before narrowing down to `limit` hits.
    const primaryPipeline = [
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
        departmentLookupStage,
        { $unwind: "$department" },
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
        // Same reordering as the primary pipeline: $text already narrows to
        // matching docs via its own index, so sort/limit before joining
        // department instead of after.
        const textSearchPipeline = [
            { $match: { $text: { $search: q.trim() } } },
            { $addFields: { relevanceScore: { $meta: "textScore" } } },
            { $sort: { relevanceScore: -1, h_index: -1 } },
            { $limit: limit },
            departmentLookupStage,
            { $unwind: "$department" },
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

    const payload = {
        success: true,
        message: "Search completed",
        data: {
            faculties,
            departments,
            total: faculties.length + departments.length
        },
        timestamp: new Date().toISOString(),
    };

    await cacheSetEx(cacheKey, SEARCH_CACHE_TTL_S, JSON.stringify(payload));
    return res.status(200).json(payload);
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

    const cacheKey = batchCacheKey("by-scopus", ids);
    const cached = await cacheGet(cacheKey);
    if (cached) {
        return res.status(200).json(JSON.parse(cached));
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

    const payload = { success: true, message: "Resolved", data: { matches }, timestamp: new Date().toISOString() };
    await cacheSetEx(cacheKey, CACHE_TTL_S, JSON.stringify(payload));
    return res.status(200).json(payload);
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

    const cacheKey = batchCacheKey("by-kerberos", ids);
    const cached = await cacheGet(cacheKey);
    if (cached) {
        return res.status(200).json(JSON.parse(cached));
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

    const payload = { success: true, message: "Resolved", data: { matches }, timestamp: new Date().toISOString() };
    await cacheSetEx(cacheKey, CACHE_TTL_S, JSON.stringify(payload));
    return res.status(200).json(payload);
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
    const cacheKey = `dir:faculty:kerberos:${k}`;

    return sendCachedJson(res, cacheKey, async () => {
        const escaped = escapeRegex(k);
        const faculty = await Faculty.findOne({ email: new RegExp('^' + escaped + '@', 'i') }).lean();
        if (!faculty) {
            throw new BadRequestError("Faculty not found for this kerberos");
        }

        const department = await findDepartmentByReference(faculty.department);
        const { kerberosIds: fkKids, expertIdToKerberos: fkE2k, expertIdToScopusIds: fkS2k } = collectKerberosInfo([faculty]);
        const subjectMap = await buildSubjectAreaMap(fkKids, fkE2k, fkS2k);
        const facultyResponse = formatDirectoryFaculty(faculty, subjectMap, { department });

        return {
            success: true,
            message: "Faculty fetched successfully",
            data: facultyResponse,
            timestamp: new Date().toISOString(),
        };
    });
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
    const cached = await cacheGet(cacheKey);
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
            await cacheSetEx(cacheKey, CACHE_TTL_S, JSON.stringify(payload));
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

    await cacheSetEx(cacheKey, CACHE_TTL_S, JSON.stringify(payload));
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
    const cached = await cacheGet(cacheKey);
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

    await cacheSetEx(cacheKey, CACHE_TTL_S, JSON.stringify(payload));
    return res.status(200).json(payload);
});




export default directory;
