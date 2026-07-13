/**
 * Directory application service facade: transport-agnostic business logic
 * behind /api/directory/*. Split by responsibility into browse / search /
 * identity / research modules; this barrel keeps REST and gRPC imports stable.
 */
export {
    listFaculty,
    getFacultiesGroupedByDepartment,
    getFacultiesForDepartmentGroup,
} from "./directoryBrowseService.js";

export { searchFaculties } from "./directorySearchService.js";

export {
    getFacultyByScopusId,
    resolveFacultiesByScopusIds,
    resolveFacultiesByKerberos,
    getFacultiesById,
    getFacultyByKerberos,
} from "./directoryIdentityService.js";

export {
    getFacultyResearchSummary,
    getFacultyPublications,
} from "./directoryResearchService.js";
