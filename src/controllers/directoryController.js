import { asyncErrorHandler } from "../middleware/errorHandler.js";
import { successResponse } from "../lib/responseUtils.js";
import { BadRequestError } from "../lib/customErrors.js";
import Faculty from "../models/faculty.js";
import Department from "../models/departments.js";
import research_scopus from "../models/research_scopus.js";
import { papersMongoFilterForFaculty, kerberosFromEmail } from "../utils/researchFacultyLink.js";
import phd_thesis from "../models/phd_thesis.js";

let directory = {};

const MAX_RESEARCH_AREAS = 8;

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

const buildSubjectAreaMap = async (kerberosIds = [], expertIdToKerberos = new Map()) => {
    if (!Array.isArray(kerberosIds) || kerberosIds.length === 0) {
        return new Map();
    }
    const areaCounts = await research_scopus.aggregate([
        { $match: { kerberos: { $in: kerberosIds } } },
        { $unwind: { path: "$subject_area", preserveNullAndEmptyArrays: false } },
        {
            $group: {
                _id: { kerberos: "$kerberos", subject: "$subject_area" },
                count: { $sum: 1 }
            }
        }
    ]);

    // Build kerberos -> sorted subject areas
    const kerberosSubjectMap = new Map();
    areaCounts.forEach(({ _id, count }) => {
        if (!_id?.kerberos || !_id.subject) return;
        const normalizedSubject = _id.subject.trim();
        if (!normalizedSubject) return;
        if (!kerberosSubjectMap.has(_id.kerberos)) {
            kerberosSubjectMap.set(_id.kerberos, []);
        }
        kerberosSubjectMap.get(_id.kerberos).push({ subject: normalizedSubject, count });
    });

    kerberosSubjectMap.forEach((list, key) => {
        const sorted = list
            .sort((a, b) => b.count - a.count)
            .map((item) => item.subject)
            .slice(0, MAX_RESEARCH_AREAS);
        kerberosSubjectMap.set(key, sorted);
    });

    // Map back to expert_id keys for compatibility with mergeResearchAreas
    const subjectMap = new Map();
    for (const [expertId, kerberos] of expertIdToKerberos) {
        const areas = kerberosSubjectMap.get(kerberos);
        if (areas) subjectMap.set(expertId, areas);
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
        department: normalizeDepartment(department),
        tags: deriveDepartmentTags(department),
        profileImageUrl: facultyDoc.profile_image_url || null,
        designation: facultyDoc.designation || null,
        workingFromYear: typeof facultyDoc.working_from_year === "number" ? facultyDoc.working_from_year : null
    };
};

/**
 * Collect kerberos IDs (derived from email) and build expert_id->kerberos mapping
 * for use with buildSubjectAreaMap.
 * @returns {{ kerberosIds: string[], expertIdToKerberos: Map<string, string> }}
 */
const collectKerberosInfo = (faculties = []) => {
    const kerberosIds = [];
    const expertIdToKerberos = new Map();
    const seen = new Set();
    faculties.forEach((faculty) => {
        const k = kerberosFromEmail(faculty?.email);
        if (k && !seen.has(k)) {
            seen.add(k);
            kerberosIds.push(k);
        }
        if (faculty?.expert_id && k) {
            expertIdToKerberos.set(faculty.expert_id, k);
        }
    });
    return { kerberosIds, expertIdToKerberos };
};

const isPossibleObjectId = (value) => typeof value === "string" && /^[0-9a-fA-F]{24}$/.test(value);

const findDepartmentByReference = async (reference) => {
    if (!reference) return null;
    if (typeof reference === "object" && reference._id) {
        return reference;
    }
    if (typeof reference === "string") {
        const byCode = await Department.findOne({ code: reference }, "name code category").lean();
        if (byCode) return byCode;
        if (isPossibleObjectId(reference)) {
            return Department.findById(reference, "name code category").lean();
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
        {
            $project: {
                expert_id: 1,
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

    const [facultiesRaw, total] = await Promise.all([
        Faculty.aggregate(pipeline),
        Faculty.countDocuments()
    ]);

    const { kerberosIds, expertIdToKerberos } = collectKerberosInfo(facultiesRaw);
    const subjectMap = await buildSubjectAreaMap(kerberosIds, expertIdToKerberos);
    const faculties = facultiesRaw.map((faculty) => formatDirectoryFaculty(faculty, subjectMap));

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

directory.getFacultiesGroupedByDepartment = asyncErrorHandler(async (req, res) => {
    const category = req.query.category; // 'departments', 'schools', 'centres', 'researchlabs'

    // Map frontend category values to database category values
    const categoryMap = {
        departments: "Department",
        schools: "School",
        centres: "Centre",
        researchlabs: "Research Lab / Facility"
    };

    const matchStage = category && categoryMap[category]
        ? { "department.category": categoryMap[category] }
        : {};

    const pipeline = [
        departmentLookupStage,
        { $unwind: "$department" },
        ...(Object.keys(matchStage).length > 0 ? [{ $match: matchStage }] : []),
        { $sort: { "department.name": 1, h_index: -1 } },
        {
            $group: {
                _id: "$department._id",
                department: { $first: "$department" },
                faculties: {
                    $push: {
                        _id: "$_id",
                        expert_id: "$expert_id",
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
                        orcid_id: "$orcid_id",
                        scopus_id: "$scopus_id",
                        profile_image_url: "$profile_image_url",
                        designation: "$designation",
                        working_from_year: "$working_from_year"
                    }
                },
                totalFaculty: { $sum: 1 },
                avgHIndex: { $avg: "$h_index" }
            }
        },
        { $sort: { "department.name": 1 } },
        {
            $project: {
                _id: 1,
                department: {
                    _id: "$department._id",
                    name: "$department.name",
                    code: "$department.code",
                    category: "$department.category"
                },
                faculties: 1,
                stats: {
                    totalFaculty: "$totalFaculty",
                    avgHIndex: { $round: ["$avgHIndex", 1] }
                }
            }
        }
    ];

    const groupedDataRaw = await Faculty.aggregate(pipeline);

    const flattenedFaculties = groupedDataRaw.flatMap((dept) => dept.faculties);
    const { kerberosIds: kIds, expertIdToKerberos: e2k } = collectKerberosInfo(flattenedFaculties);
    const subjectMap = await buildSubjectAreaMap(kIds, e2k);

    const groupedData = groupedDataRaw.map((dept) => ({
        ...dept,
        faculties: dept.faculties.map((faculty) =>
            formatDirectoryFaculty(faculty, subjectMap, { department: dept.department })
        )
    }));

    return successResponse(res, {
        departments: groupedData,
        totalDepartments: groupedData.length,
        totalFaculty: groupedData.reduce((sum, d) => sum + d.stats.totalFaculty, 0)
    }, "Grouped faculties fetched successfully", 200);
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

    const { kerberosIds: sKids, expertIdToKerberos: sE2k } = collectKerberosInfo(facultiesRaw);
    const subjectMap = await buildSubjectAreaMap(sKids, sE2k);
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
    const { kerberosIds: bsKids, expertIdToKerberos: bsE2k } = collectKerberosInfo([faculty]);
    const subjectMap = await buildSubjectAreaMap(bsKids, bsE2k);
    const facultyResponse = formatDirectoryFaculty(faculty, subjectMap, { department });

    return successResponse(res, facultyResponse, "Faculty fetched successfully", 200);
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
    const { kerberosIds: fbKids, expertIdToKerberos: fbE2k } = collectKerberosInfo([faculty]);
    const subjectMap = await buildSubjectAreaMap(fbKids, fbE2k);
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
    const scopusId = pickPrimaryIdentifier(faculty.scopus_id);
    const papersWithFaculty = await research_scopus.find(
        papersMongoFilterForFaculty(faculty)
    ).lean();
    const coworkersFromScopus = new Map();
    papersWithFaculty.forEach((paper) => {
        (paper.authors || []).forEach((author) => {
            if (!author?.author_id) return;
            if (scopusId && author.author_id === scopusId) return;
            if (coworkersFromScopus.has(author.author_id)) return;
            coworkersFromScopus.set(author.author_id, {
                title: paper.title,
                publication_year: paper.publication_year,
                document_type: paper.document_type,
                subject_area: paper.subject_area || [],
                name: author.author_name,
                affiliation: author.author_affiliation || paper.field_associated || "External collaborator",
                author_id: author.author_id,
                matched_profile: author.matched_profile || null
            });
        });
    });

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
    const studentsFromThesis = thesesWithFaculty.map((thesis) => ({
        name: thesis.contributor?.author,
        affiliation: "IIT Delhi",
        thesis_title: thesis.title,
        year: thesis.publication_year || null
    }));

    const displayName = [faculty.title, faculty.firstName, faculty.lastName]
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

    return successResponse(res, {
        faculty: {
            name: displayName,
            _id: faculty._id
        },
        hIndex: faculty.h_index ?? 0,
        citationCount: faculty.citation_count ?? 0,
        scopusId,
        coworkersFromPapers: Array.from(coworkersFromScopus.values()),
        studentsSupervised: studentsFromThesis,
        stats: {
            totalPapers: papersWithFaculty.length,
            uniqueCoauthors: coworkersFromScopus.size,
            totalStudentsSupervised: studentsFromThesis.length
        }
    }, "Coworkers fetched successfully", 200);
});




export default directory;
