import {
    buildSubjectAreaMap,
    formatDirectoryFaculty,
    collectKerberosInfo,
    escapeRegex,
    departmentLookupStage
} from "../domain/facultyDirectory.js";
import { SEARCH_CACHE_TTL_S, cachedPayload } from "./directoryCache.js";
import * as repo from "./directoryRepository.js";

const SEARCH_PROJECT = {
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
};

export const searchFaculties = async ({ q, limit } = {}) => {
    const l = Math.min(20, Math.max(1, parseInt(limit) || 10));

    if (!q || q.trim().length < 2) {
        return {
            data: { faculties: [], departments: [], total: 0 },
            message: "Search query too short",
            cached: false
        };
    }

    const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean);

    if (tokens.length === 0) {
        return {
            data: { faculties: [], departments: [], total: 0 },
            message: "Search query too short",
            cached: false
        };
    }

    const cacheKey = `dir:search:${tokens.join(" ")}:${l}`;

    return cachedPayload(cacheKey, SEARCH_CACHE_TTL_S, async () => {
        const tokenMatchConditions = tokens.map((token) => ({
            fullName: { $regex: escapeRegex(token), $options: "i" }
        }));

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
            { $limit: l },
            departmentLookupStage,
            { $unwind: "$department" },
            { $project: SEARCH_PROJECT }
        ];

        const deptRegex = new RegExp(tokens.map(escapeRegex).join(".*"), "i");
        const departmentPromise = repo.findDepartmentsByNameRegex(deptRegex, 5);

        let [facultiesRaw, departments] = await Promise.all([
            repo.aggregateFaculties(primaryPipeline),
            departmentPromise
        ]);

        if (facultiesRaw.length === 0) {
            // Same reordering as the primary pipeline: $text already narrows to
            // matching docs via its own index, so sort/limit before joining
            // department instead of after.
            const textSearchPipeline = [
                { $match: { $text: { $search: q.trim() } } },
                { $addFields: { relevanceScore: { $meta: "textScore" } } },
                { $sort: { relevanceScore: -1, h_index: -1 } },
                { $limit: l },
                departmentLookupStage,
                { $unwind: "$department" },
                { $project: SEARCH_PROJECT }
            ];
            facultiesRaw = await repo.aggregateFaculties(textSearchPipeline);
        }

        const { kerberosIds: sKids, expertIdToKerberos: sE2k, expertIdToScopusIds: sS2k } = collectKerberosInfo(facultiesRaw);
        const subjectMap = await buildSubjectAreaMap(sKids, sE2k, sS2k);
        const faculties = facultiesRaw.map((faculty) => formatDirectoryFaculty(faculty, subjectMap));

        return {
            message: "Search completed",
            data: {
                faculties,
                departments,
                total: faculties.length + departments.length
            }
        };
    });
};
