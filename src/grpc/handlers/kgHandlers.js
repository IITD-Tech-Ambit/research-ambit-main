/**
 * directory.v1.KnowledgeGraphService handlers. File-driven / polymorphic
 * payloads are carried as `*_json` strings (JSON.stringify of the exact REST
 * `data`); the few strongly-typed responses (health, paper meta, atlas index
 * lookups, cluster breakdown) are mapped field-by-field. `found=false` for
 * ExploreDetail/GetPaperMeta reproduces the REST 404 (the service throws
 * NotFoundError, which the gateway would render as 404 either way).
 */
import { unary } from "../handlerUtils.js";
import { NotFoundError } from "../../lib/customErrors.js";

export function createKgHandlers(kgService) {
    return {
        GetHealth: unary(async () => {
            const { data } = await kgService.getHealth();
            return {
                graphs_ready: !!data.graphsReady,
                explore_ready: !!data.exploreReady,
                atlas_ready: !!data.atlasReady,
                atlas_count: data.atlasCount ?? 0,
                data_dir: data.dataDir || "",
                redis_connected: !!data.redisConnected,
                cache_ttl_seconds: data.cacheTtlSeconds ?? 0,
            };
        }),

        GetFacultyIndex: unary(async () => {
            const { data } = await kgService.getFacultyIndex();
            return { data_json: JSON.stringify(data) };
        }),

        GetFacultyKnowledgeGraph: unary(async ({ request: r }) => {
            const { data } = await kgService.getFacultyGraph({ id: r.id });
            return { data_json: JSON.stringify(data) };
        }),

        ExploreTerms: unary(async ({ request: r }) => {
            const { data } = await kgService.getExploreTerms({ q: r.q, type: r.type, limit: r.limit });
            return { data_json: JSON.stringify(data) };
        }),

        ExploreDetail: unary(async ({ request: r }) => {
            try {
                const { data } = await kgService.getExploreDetail({ key: r.key });
                return { found: true, detail_json: JSON.stringify(data) };
            } catch (err) {
                if (err instanceof NotFoundError) return { found: false, detail_json: "" };
                throw err;
            }
        }),

        GetPaperMeta: unary(async ({ request: r }) => {
            let data;
            try {
                ({ data } = await kgService.getPaperMeta({ id: r.id }));
            } catch (err) {
                if (err instanceof NotFoundError) return { found: false };
                throw err;
            }
            return {
                found: true,
                link: data.link || "",
                document_scopus_id: data.document_scopus_id || "",
                document_eid: data.document_eid || "",
                title: data.title || "",
                abstract: data.abstract || "",
                publication_year: Number(data.publication_year) || 0,
                citation_count: data.citation_count ?? 0,
                reference_count: data.reference_count ?? 0,
                document_type: data.document_type || "",
                field_associated: data.field_associated || "",
                subject_area: Array.isArray(data.subject_area) ? data.subject_area : [],
                authors: (data.authors || []).map((a) => ({
                    name: a.name || "",
                    author_id: a.author_id || "",
                    position: Number(a.position) || 0,
                })),
                iitd_faculty: (data.iitd_faculty || []).map((f) => ({
                    faculty_id: f.facultyId || "",
                    name: f.name || "",
                    department: f.department || "",
                    kerberos: f.kerberos || "",
                })),
            };
        }),

        GetAtlas: unary(async ({ request: r }) => {
            const { notModified, etag, body } = await kgService.getAtlas({ ifNoneMatch: r.if_none_match });
            return {
                not_modified: !!notModified,
                etag: etag || "",
                body_json: body || "",
            };
        }),

        SearchAtlas: unary(async ({ request: r }) => {
            const { data } = await kgService.searchAtlas({ q: r.q, limit: r.limit });
            return {
                query: data.query || "",
                match_count: data.matchCount ?? 0,
                indices: data.indices || [],
            };
        }),

        GetAtlasFacultyIndices: unary(async ({ request: r }) => {
            const { data } = await kgService.getFacultyAtlasIndices({ ids: r.ids });
            return {
                faculty_ids: data.facultyIds || [],
                match_count: data.matchCount ?? 0,
                indices: data.indices || [],
            };
        }),

        SearchAtlasFaculty: unary(async ({ request: r }) => {
            const { data } = await kgService.searchAtlasFaculty({ q: r.q, limit: r.limit });
            return {
                query: data.query || "",
                matches: (data.matches || []).map((m) => ({
                    faculty_id: m.facultyId || "",
                    name: m.name || "",
                    department: m.department || "",
                    paper_count: m.paperCount ?? 0,
                    atlas_count: m.atlasCount ?? 0,
                })),
                match_count: data.matchCount ?? 0,
                indices: data.indices || [],
            };
        }),

        GetAtlasDepartmentIndices: unary(async ({ request: r }) => {
            const { data } = await kgService.getDepartmentAtlasIndices({ departments: r.departments });
            return {
                departments: data.departments || [],
                match_count: data.matchCount ?? 0,
                indices: data.indices || [],
            };
        }),

        SearchAtlasDepartment: unary(async ({ request: r }) => {
            const { data } = await kgService.searchAtlasDepartment({ q: r.q, limit: r.limit });
            return {
                query: data.query || "",
                matches: (data.matches || []).map((m) => ({
                    department: m.department || "",
                    faculty_count: m.facultyCount ?? 0,
                    atlas_count: m.atlasCount ?? 0,
                })),
                match_count: data.matchCount ?? 0,
                indices: data.indices || [],
            };
        }),

        GetAtlasTree: unary(async () => {
            const { data } = await kgService.getAtlasTree();
            return { data_json: JSON.stringify(data) };
        }),

        GetAtlasDict: unary(async () => {
            const { data } = await kgService.getAtlasDict();
            return { data_json: JSON.stringify(data) };
        }),

        GetAtlasTile: unary(async ({ request: r }) => {
            const { version, nodeKey, etag, payload } = await kgService.getAtlasTile({ nodeKey: r.node_key });
            const pointCount = payload.length >= 4 ? payload.readUInt32LE(0) : 0;
            return { version, node_key: nodeKey, etag, point_count: pointCount, payload };
        }),

        GetAtlasPoints: unary(async ({ request: r }) => {
            const { data } = await kgService.getAtlasPoints({ indices: r.indices });
            return {
                points: (data.points || []).map((p) => ({ i: p.i, x: p.x, y: p.y, z: p.z })),
            };
        }),

        GetAtlasClusterBreakdown: unary(async ({ request: r }) => {
            const { data } = await kgService.getAtlasClusterBreakdown({
                theme: r.theme,
                q: r.q,
                paperLimit: r.paper_limit,
            });
            return {
                theme: data.theme || "",
                query: data.query || "",
                total_papers: data.totalPapers ?? 0,
                departments: (data.departments || []).map((d) => ({
                    department: d.department || "",
                    paper_count: d.paperCount ?? 0,
                    papers: (d.papers || []).map((p) => ({
                        id: p.id || "",
                        i: p.i ?? 0,
                        title: p.title || "",
                        domain: p.domain || "",
                        topic: p.topic || "",
                        citations: p.citations ?? 0,
                    })),
                })),
            };
        }),
    };
}
