import { BadRequestError, NotFoundError } from "../lib/customErrors.js";
import { pickPrimaryIdentifier } from "../domain/facultyDirectory.js";
import { getScholarResearchBlock } from "../utils/fetchScholarData.js";
import { CACHE_TTL_S, cachedPayload } from "./directoryCache.js";
import * as repo from "./directoryRepository.js";

export const getFacultyResearchSummary = async ({ kerberos, yearLimit, yearOffset } = {}) => {
    if (!kerberos || !kerberos.trim()) {
        throw new BadRequestError("Kerberos id is required");
    }
    const k = kerberos.trim().toLowerCase();
    const yLimit = Math.min(20, Math.max(1, parseInt(yearLimit) || 5));
    const yOffset = Math.max(0, parseInt(yearOffset) || 0);

    const cacheKey = `summary:${k}:${yOffset}:${yLimit}`;

    return cachedPayload(cacheKey, CACHE_TTL_S, async () => {
        const faculty = await repo.resolveFacultyByKerberos(k);
        if (!faculty) {
            throw new NotFoundError("Faculty not found for this kerberos");
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
                for (const paper of scholarPapers) {
                    if (!paper.year) continue;
                    if (!timelineMap.has(paper.year)) timelineMap.set(paper.year, []);
                    timelineMap.get(paper.year).push(paper);
                }
                const allYears = [...timelineMap.entries()]
                    .sort((a, b) => b[0] - a[0])
                    .map(([year, papers]) => ({
                        year,
                        count: papers.length,
                        papers: papers
                            .sort((a, b) => (b.citations || 0) - (a.citations || 0))
                            .slice(0, 3)
                            .map((paper) => ({
                                title: paper.title || "",
                                type: paper.type || "Publication",
                                citations: paper.citations || 0,
                                link: paper.url || null,
                                document_scopus_id: null,
                                authors: (Array.isArray(paper.authors) ? paper.authors : []).map((n) => ({
                                    name: typeof n === "string" ? n : n?.author_name || "",
                                    author_id: "",
                                    matched_profile: null,
                                })),
                            })),
                    }));

                const totalYears = allYears.length;
                const timeline = allYears.slice(yOffset, yOffset + yLimit);

                return {
                    message: "Research summary fetched successfully",
                    data: {
                        faculty: { name: displayName, _id: faculty._id },
                        source: "scholar",
                        hIndex: faculty.h_index ?? scholarBlock.hIndex ?? 0,
                        citationCount: faculty.citation_count ?? scholarBlock.citationCount ?? 0,
                        scopusId: undefined,
                        stats: { totalPapers: scholarPapers.length, totalYears },
                        timeline,
                        yearOffset: yOffset,
                        yearLimit: yLimit,
                    }
                };
            }
        }

        const papersMatch = repo.buildPapersMatch(k, scopusIds);

        const [aggResult] = await repo.aggregateResearch([
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
        const paginatedYears = allTimelineYears.slice(yOffset, yOffset + yLimit);

        const timeline = paginatedYears.map((y) => ({
            year: y.year,
            count: y.count,
            papers: (y.papers || []).map((paper) => ({
                title: paper.title || "",
                type: paper.type || "Publication",
                citations: paper.citations ?? 0,
                link: paper.link || null,
                document_scopus_id: paper.document_scopus_id || null,
                authors: (paper.authors || []).map((a) => ({
                    name: a.author_name || "",
                    author_id: a.author_id || "",
                    matched_profile: a.matched_profile || null,
                })),
            })),
        }));

        const totalPapers = aggResult?.stats?.[0]?.totalPapers ?? 0;

        return {
            message: "Research summary fetched successfully",
            data: {
                faculty: { name: displayName, _id: faculty._id },
                source: "scopus",
                hIndex: faculty.h_index ?? 0,
                citationCount: faculty.citation_count ?? 0,
                scopusId: pickPrimaryIdentifier(faculty.scopus_id),
                stats: { totalPapers, totalYears },
                timeline,
                yearOffset: yOffset,
                yearLimit: yLimit,
            }
        };
    });
};

export const getFacultyPublications = async ({ kerberos, year, skip, limit } = {}) => {
    const y = parseInt(year);
    const skipN = Math.max(0, parseInt(skip) || 0);
    const l = Math.min(50, Math.max(1, parseInt(limit) || 20));

    if (!kerberos || !kerberos.trim()) {
        throw new BadRequestError("Kerberos id is required");
    }
    if (!y || isNaN(y)) {
        throw new BadRequestError("Valid year query param is required");
    }

    const k = kerberos.trim().toLowerCase();
    const cacheKey = `pubs:${k}:${y}:${skipN}:${l}`;

    return cachedPayload(cacheKey, CACHE_TTL_S, async () => {
        const faculty = await repo.resolveFacultyByKerberos(k);
        if (!faculty) {
            throw new NotFoundError("Faculty not found for this kerberos");
        }

        const scopusIds = (faculty.scopus_id || []).map(String).filter(Boolean);
        const papersMatch = repo.buildPapersMatch(k, scopusIds);
        const matchStage = { ...papersMatch, publication_year: y };

        const [papers, countResult] = await Promise.all([
            repo.aggregateResearch([
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
                { $skip: skipN },
                { $limit: l },
            ]),
            repo.countResearchDocuments(matchStage),
        ]);

        const formattedPapers = papers.map((paper) => ({
            title: paper.title || "",
            type: paper.document_type || "Publication",
            citations: paper.citation_count ?? 0,
            link: paper.link || null,
            document_scopus_id: paper.document_scopus_id || null,
            authors: (paper.authors || []).map((a) => ({
                name: a.author_name || "",
                author_id: a.author_id || "",
                matched_profile: a.matched_profile || null,
            })),
        }));

        return {
            message: "Publications fetched successfully",
            data: { year: y, total: countResult, papers: formattedPapers, skip: skipN, limit: l }
        };
    });
};
