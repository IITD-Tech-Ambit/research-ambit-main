/**
 * directory.v1.DirectoryService handlers. Thin: map the typed request onto the
 * shared directoryService inputs, then map the returned DTO onto the proto
 * response. Depends only on the injected service (a port), never on Express.
 */
import { unary } from "../handlerUtils.js";
import {
    mapFacultyCard,
    mapFaculty,
    mapPagination,
    mapFacultyMatches,
    mapDepartments,
} from "../mappers.js";

export function createDirectoryHandlers(directoryService) {
    return {
        ListFaculty: unary(async ({ request: r }) => {
            const { data } = await directoryService.listFaculty({
                page: r.page,
                limit: r.limit,
                sortBy: r.sort_by,
                order: r.order,
            });
            return {
                data: (data.data || []).map(mapFacultyCard),
                pagination: mapPagination(data.pagination),
            };
        }),

        SearchDirectory: unary(async ({ request: r }) => {
            const { data, message } = await directoryService.searchFaculties({
                q: r.q,
                limit: r.limit,
            });
            return {
                faculties: (data.faculties || []).map(mapFaculty),
                departments: mapDepartments(data.departments),
                total: data.total ?? 0,
                message,
            };
        }),

        GetGrouped: unary(async ({ request: r }) => {
            const { data } = await directoryService.getFacultiesGroupedByDepartment({
                category: r.category,
                summaryOnly: r.summary_only,
            });
            return {
                departments: (data.departments || []).map((g) => {
                    const stats = {};
                    stats.total_faculty = g.stats?.totalFaculty ?? 0;
                    if (g.stats?.avgHIndex !== undefined && g.stats?.avgHIndex !== null) {
                        stats.avg_h_index = g.stats.avgHIndex;
                    }
                    const dept = {
                        id: g._id !== undefined && g._id !== null ? String(g._id) : "",
                        department: g.department
                            ? {
                                  ...(g.department._id != null ? { id: String(g.department._id) } : {}),
                                  ...(g.department.name != null ? { name: g.department.name } : {}),
                                  ...(g.department.code != null ? { code: g.department.code } : {}),
                                  ...(g.department.category != null ? { category: g.department.category } : {}),
                              }
                            : undefined,
                        stats,
                        faculties: (g.faculties || []).map(mapFacultyCard),
                    };
                    return dept;
                }),
                total_departments: data.totalDepartments ?? 0,
                total_faculty: data.totalFaculty ?? 0,
            };
        }),

        GetDepartmentFaculties: unary(async ({ request: r }) => {
            const { data } = await directoryService.getFacultiesForDepartmentGroup({
                departmentId: r.department_id,
                category: r.category,
            });
            return { faculties: (data.faculties || []).map(mapFacultyCard) };
        }),

        GetFacultyByScopus: unary(async ({ request: r }) => {
            const { data } = await directoryService.getFacultyByScopusId({ scopusId: r.scopus_id });
            return { faculty: mapFaculty(data) };
        }),

        BatchFacultyByScopus: unary(async ({ request: r }) => {
            const { data } = await directoryService.resolveFacultiesByScopusIds({ scopusIds: r.scopus_ids });
            return { matches: mapFacultyMatches(data.matches) };
        }),

        BatchFacultyByKerberos: unary(async ({ request: r }) => {
            const { data } = await directoryService.resolveFacultiesByKerberos({ kerberosIds: r.kerberos_ids });
            return { matches: mapFacultyMatches(data.matches) };
        }),

        GetFacultyProfile: unary(async ({ request: r }) => {
            const { data } = await directoryService.getFacultyByKerberos({ kerberos: r.kerberos });
            return { faculty: mapFaculty(data) };
        }),

        GetFacultyResearchSummary: unary(async ({ request: r }) => {
            const { data } = await directoryService.getFacultyResearchSummary({
                kerberos: r.kerberos,
                yearLimit: r.year_limit,
                yearOffset: r.year_offset,
            });
            return { data_json: JSON.stringify(data) };
        }),

        GetFacultyPublications: unary(async ({ request: r }) => {
            const { data } = await directoryService.getFacultyPublications({
                kerberos: r.kerberos,
                year: r.year,
                skip: r.skip,
                limit: r.limit,
            });
            return { data_json: JSON.stringify(data) };
        }),

        GetFacultyById: unary(async ({ request: r }) => {
            const { data } = await directoryService.getFacultiesById({ id: r.id });
            return { faculty: mapFaculty(data) };
        }),
    };
}
