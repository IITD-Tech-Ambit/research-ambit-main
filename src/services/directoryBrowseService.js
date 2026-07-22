import { BadRequestError, NotFoundError } from "../lib/customErrors.js";
import {
    normalizeDepartment,
    findDepartmentByReference,
    departmentLookupStage,
    facultyCardProjectFields,
    facultyCardPushFields,
    formatDirectoryFacultyCards,
    formatGroupedFaculties,
    DIRECTORY_CATEGORY_MAP,
    buildGroupedCategoryMatch,
    facultyUnitsExpandStages
} from "../domain/facultyDirectory.js";
import {
    getDepartmentRosterIds,
    buildDepartmentRosterMatchStage
} from "../domain/departmentSheetRoster.js";
import { CACHE_TTL_S, cachedPayload, dirCacheKey } from "./directoryCache.js";
import * as repo from "./directoryRepository.js";

export const listFaculty = async ({ page, limit, sortBy, order } = {}) => {
    const p = Math.max(1, parseInt(page) || 1);
    const l = Math.min(100, Math.max(1, parseInt(limit) || 9));
    const by = sortBy || "h_index";
    const ord = order === "asc" ? "asc" : "desc";

    const cacheKey = dirCacheKey("list", p, l, by, ord);

    return cachedPayload(cacheKey, CACHE_TTL_S, async () => {
        const skip = (p - 1) * l;
        const sortOrder = ord === "asc" ? 1 : -1;

        const sortFields = {
            name: "firstName",
            h_index: "h_index",
            hIndex: "h_index",
            citations: "citation_count",
            citation_count: "citation_count",
            citationCount: "citation_count"
        };
        const sortField = sortFields[by] || "h_index";

        // Sort/paginate on bare Faculty docs first (index-backed), then only
        // run the department $lookup against the page actually returned —
        // this used to lookup+unwind the whole collection before paginating,
        // which meant every page turned into a full collection scan+join.
        const pipeline = [
            { $sort: { [sortField]: sortOrder, _id: 1 } },
            { $skip: skip },
            { $limit: l },
            departmentLookupStage,
            { $unwind: "$department" },
            { $project: facultyCardProjectFields }
        ];

        const [facultiesRaw, total] = await Promise.all([
            repo.aggregateFaculties(pipeline),
            repo.countFaculties()
        ]);

        const faculties = formatDirectoryFacultyCards(facultiesRaw);
        const totalPages = Math.ceil(total / l);

        return {
            message: "Faculties fetched successfully",
            data: {
                data: faculties,
                pagination: {
                    page: p,
                    limit: l,
                    total,
                    totalPages,
                    hasNext: p < totalPages,
                    hasPrev: p > 1
                }
            }
        };
    });
};

export const getFacultiesGroupedByDepartment = async ({ category, summaryOnly } = {}) => {
    const cat = String(category ?? "all").trim().toLowerCase() || "all";
    const summary = summaryOnly === true || summaryOnly === "true";
    const cacheKey = dirCacheKey("grouped", summary ? "summary" : "full", cat);

    return cachedPayload(cacheKey, CACHE_TTL_S, async () => {
        if (summary) {
            // Group on the raw, unjoined `department` field first — a single cheap
            // pass over Faculty with no department join — then resolve only the
            // handful of distinct department references that came back (not all
            // 1,040 faculty rows) to their documents. Avoids the O(n×m) lookup+
            // unwind the non-summary path below needs for per-faculty fields.
            const rawGroups = await repo.groupFacultyCountsByDepartment();

            const resolved = await Promise.all(
                rawGroups.map(async (g) => ({
                    totalFaculty: g.totalFaculty,
                    department: await findDepartmentByReference(g._id)
                }))
            );

            const categoryFilter = cat !== "all" && DIRECTORY_CATEGORY_MAP[cat];
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

            // The Departments tab shows only sheet-verified faculty (see
            // departmentSheetRoster.js), so its counts must match that roster.
            // The "All" tab keeps full DB counts.
            if (cat === "departments") {
                for (const group of merged.values()) {
                    const rosterIds = getDepartmentRosterIds(group._id);
                    if (rosterIds) group.stats.totalFaculty = rosterIds.length;
                }
            }

            const departments = [...merged.values()].sort((a, b) =>
                a.department.name.localeCompare(b.department.name)
            );

            return {
                message: "Grouped department summary fetched successfully",
                data: {
                    departments,
                    totalDepartments: departments.length,
                    totalFaculty: departments.reduce((sum, d) => sum + d.stats.totalFaculty, 0)
                }
            };
        }

        // When filtering by category, resolve which departments match first (a
        // handful of docs, cheap) and match Faculty rows against them on the
        // indexed `department` field before joining — instead of joining the
        // whole Faculty collection and filtering on department.category after.
        const categoryDbValue = cat !== "all" && DIRECTORY_CATEGORY_MAP[cat];
        let preMatchStage = null;
        if (categoryDbValue) {
            const matchedDepartments = await repo.findDepartmentsByCategory(categoryDbValue);
            const values = [];
            for (const d of matchedDepartments) {
                values.push(d._id, String(d._id));
                if (d.code) values.push(d.code);
            }
            if (values.length === 0) {
                return {
                    message: "Grouped faculties fetched successfully",
                    data: { departments: [], totalDepartments: 0, totalFaculty: 0 }
                };
            }
            // A faculty belongs to a category's units via either its home
            // department or a school/centre affiliation.
            preMatchStage = {
                $match: {
                    $or: [
                        { department: { $in: values } },
                        { affiliations: { $in: values } }
                    ]
                }
            };
        }

        const pipeline = [
            ...(preMatchStage ? [preMatchStage] : []),
            // Expand each faculty into one row per unit (department +
            // affiliations) so dual-affiliated faculty appear in every unit
            // they belong to, with the same profile data.
            ...facultyUnitsExpandStages,
            { $unwind: "$department" },
            // The expansion emits rows for all of a faculty's units; keep
            // only units of the requested category (e.g. drop the home
            // department row when browsing schools/centres).
            ...(categoryDbValue
                ? [{ $match: { "department.category": categoryDbValue } }]
                : []),
            // Departments tab lists only sheet-verified faculty per unit;
            // everyone else in the DB remains visible on the "All" tab.
            ...(cat === "departments" && buildDepartmentRosterMatchStage()
                ? [buildDepartmentRosterMatchStage()]
                : []),
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

        const groupedDataRaw = await repo.aggregateFaculties(pipeline);
        const groupedData = await formatGroupedFaculties(groupedDataRaw);

        return {
            message: "Grouped faculties fetched successfully",
            data: {
                departments: groupedData,
                totalDepartments: groupedData.length,
                totalFaculty: groupedData.reduce((sum, d) => sum + d.stats.totalFaculty, 0)
            }
        };
    });
};

export const getFacultiesForDepartmentGroup = async ({ departmentId, category } = {}) => {
    const cat = String(category ?? "all").trim().toLowerCase() || "all";

    if (!departmentId || !repo.isValidObjectId(departmentId)) {
        throw new BadRequestError("Valid department id is required");
    }

    const cacheKey = dirCacheKey("grouped", "dept", cat, departmentId);

    return cachedPayload(cacheKey, CACHE_TTL_S, async () => {
        const departmentObjectId = repo.toObjectId(departmentId);
        const department = await repo.findDepartmentById(departmentObjectId, "name code category");
        if (!department) {
            throw new NotFoundError("Department not found");
        }
        const categoryMatch = buildGroupedCategoryMatch(cat === "all" ? undefined : cat);
        if (categoryMatch["department.category"] && categoryMatch["department.category"] !== department.category) {
            throw new NotFoundError("Department not found");
        }

        // Faculty.department is declared as an ObjectId, but some rows were
        // inserted with the department's code or its stringified id instead (the
        // same inconsistency departmentLookupStage's $expr works around) — match
        // all three forms directly against the indexed `department` field
        // instead of joining the whole collection first and filtering after.
        const departmentMatchClauses = [
            { department: departmentObjectId },
            { department: String(departmentObjectId) },
            { affiliations: departmentObjectId }
        ];
        if (department.code) departmentMatchClauses.push({ department: department.code });

        // When browsing the Departments tab, restrict a department's page to
        // its sheet-verified roster; "all" and other categories are unfiltered.
        const rosterIds = cat === "departments" ? getDepartmentRosterIds(departmentObjectId) : null;
        const facultyMatch = rosterIds
            ? { $and: [{ $or: departmentMatchClauses }, { _id: { $in: rosterIds } }] }
            : { $or: departmentMatchClauses };

        const facultiesRaw = await repo.aggregateFaculties([
            { $match: facultyMatch },
            { $sort: { h_index: -1, _id: 1 } },
            { $project: facultyCardProjectFields }
        ]);

        if (facultiesRaw.length === 0) {
            throw new NotFoundError("Department not found");
        }

        const normalizedDepartment = normalizeDepartment(department);
        const faculties = formatDirectoryFacultyCards(facultiesRaw, normalizedDepartment);

        return {
            message: "Department faculties fetched successfully",
            data: { faculties }
        };
    });
};
