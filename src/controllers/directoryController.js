import { asyncErrorHandler } from "../middleware/errorHandler.js";
import { successResponse } from "../lib/responseUtils.js";
import * as directoryService from "../services/directoryService.js";

let directory = {};

directory.getAllFaculties = asyncErrorHandler(async (req, res) => {
    const { data, message, cached } = await directoryService.listFaculty(req.query);
    res.setHeader("X-Cache", cached ? "HIT" : "MISS");
    return successResponse(res, data, message, 200);
});

directory.getFacultiesGroupedByDepartment = asyncErrorHandler(async (req, res) => {
    const { data, message, cached } = await directoryService.getFacultiesGroupedByDepartment({
        category: req.query.category,
        summaryOnly: req.query.summaryOnly
    });
    res.setHeader("X-Cache", cached ? "HIT" : "MISS");
    return successResponse(res, data, message, 200);
});

directory.getFacultiesForDepartmentGroup = asyncErrorHandler(async (req, res) => {
    const { data, message, cached } = await directoryService.getFacultiesForDepartmentGroup({
        departmentId: req.params.departmentId,
        category: req.query.category
    });
    res.setHeader("X-Cache", cached ? "HIT" : "MISS");
    return successResponse(res, data, message, 200);
});

directory.searchFaculties = asyncErrorHandler(async (req, res) => {
    const { data, message } = await directoryService.searchFaculties({
        q: req.query.q,
        limit: req.query.limit
    });
    return successResponse(res, data, message, 200);
});

directory.getFacultyByScopusId = asyncErrorHandler(async (req, res) => {
    const { data, message } = await directoryService.getFacultyByScopusId({ scopusId: req.params.scopusId });
    return successResponse(res, data, message, 200);
});

directory.resolveFacultiesByScopusIds = asyncErrorHandler(async (req, res) => {
    const { data, message } = await directoryService.resolveFacultiesByScopusIds({ scopusIds: req.body?.scopusIds });
    return successResponse(res, data, message, 200);
});

directory.resolveFacultiesByKerberos = asyncErrorHandler(async (req, res) => {
    const { data, message } = await directoryService.resolveFacultiesByKerberos({ kerberosIds: req.body?.kerberosIds });
    return successResponse(res, data, message, 200);
});

directory.getFacultiesById = asyncErrorHandler(async (req, res) => {
    const { data, message } = await directoryService.getFacultiesById({ id: req.params.id });
    return successResponse(res, data, message, 200);
});

directory.getFacultyByKerberos = asyncErrorHandler(async (req, res) => {
    const { data, message, cached } = await directoryService.getFacultyByKerberos({ kerberos: req.params.kerberos });
    res.setHeader("X-Cache", cached ? "HIT" : "MISS");
    return successResponse(res, data, message, 200);
});

directory.getFacultyResearchSummary = asyncErrorHandler(async (req, res) => {
    const { data, message } = await directoryService.getFacultyResearchSummary({
        kerberos: req.params.kerberos,
        yearLimit: req.query.yearLimit,
        yearOffset: req.query.yearOffset
    });
    return successResponse(res, data, message, 200);
});

directory.getFacultyPublications = asyncErrorHandler(async (req, res) => {
    const { data, message } = await directoryService.getFacultyPublications({
        kerberos: req.params.kerberos,
        year: req.query.year,
        skip: req.query.skip,
        limit: req.query.limit
    });
    return successResponse(res, data, message, 200);
});

export default directory;
