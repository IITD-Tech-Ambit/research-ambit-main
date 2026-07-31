import fs from "fs";
import { asyncErrorHandler } from "../middleware/errorHandler.js";
import { successResponse } from "../lib/responseUtils.js";
import * as directoryService from "../services/directoryService.js";
import { updateFacultyImageByKerberos, updateFacultyVisibilityByKerberos } from "../services/directoryRepository.js";
import { uploadToCloudinary } from "../lib/cloudinary.js";
import { cacheDelByPrefix } from "../lib/cache.js";
import { DIR_CACHE_PREFIX } from "../services/directoryCache.js";

let directory = {};

const safeUnlink = (p) => { try { if (p) fs.unlinkSync(p); } catch { /* already gone */ } };

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

// Faculty self-service: replace one's own profile image. The gateway verifies
// the ra_session and injects the trusted x-user-kerberos header; a faculty may
// only edit their OWN profile (header kerberos must equal the path kerberos).
// Uploads to Cloudinary (faculty_images), stores the new URL on the faculty
// doc, and flushes the directory cache so the image updates everywhere at once.
directory.updateFacultyImage = asyncErrorHandler(async (req, res) => {
    const kerberos = String(req.params.kerberos || "").toLowerCase();
    const authKerberos = String(req.headers["x-user-kerberos"] || "").toLowerCase();

    if (!authKerberos) {
        safeUnlink(req.file?.path);
        return res.status(401).json({ success: false, message: "Not authenticated." });
    }
    if (authKerberos !== kerberos) {
        safeUnlink(req.file?.path);
        return res.status(403).json({ success: false, message: "You can only edit your own profile." });
    }
    if (!req.file?.path) {
        return res.status(400).json({ success: false, message: "No image file provided." });
    }

    // uploadToCloudinary unlinks the temp file on both success and failure.
    const url = await uploadToCloudinary(req.file.path, "faculty_images");
    if (!url) {
        return res.status(502).json({ success: false, message: "Image upload failed." });
    }

    const updated = await updateFacultyImageByKerberos(kerberos, url);
    if (!updated) {
        return res.status(404).json({ success: false, message: `No faculty found for "${kerberos}".` });
    }

    // Invalidate cached profiles/search/grouped so the new image shows at once.
    await cacheDelByPrefix(DIR_CACHE_PREFIX);

    return successResponse(res, { profileImageUrl: url }, "Profile image updated.", 200);
});

// Faculty self-service: toggle which of their metrics (h_index / citations /
// papers / patents) are visible. Owner-only. Values are never deleted — a hidden
// metric is just flagged, so it can be shown again later. Flushes the directory
// cache so the change takes effect everywhere at once.
directory.updateFacultyVisibility = asyncErrorHandler(async (req, res) => {
    const kerberos = String(req.params.kerberos || "").toLowerCase();
    const authKerberos = String(req.headers["x-user-kerberos"] || "").toLowerCase();

    if (!authKerberos) {
        return res.status(401).json({ success: false, message: "Not authenticated." });
    }
    if (authKerberos !== kerberos) {
        return res.status(403).json({ success: false, message: "You can only edit your own profile." });
    }

    const body = req.body || {};
    const visibility = {};
    for (const key of ["h_index", "citations", "papers", "patents"]) {
        if (typeof body[key] === "boolean") visibility[key] = body[key];
    }
    if (Object.keys(visibility).length === 0) {
        return res.status(400).json({ success: false, message: "No visibility flags provided." });
    }

    const updated = await updateFacultyVisibilityByKerberos(kerberos, visibility);
    if (!updated) {
        return res.status(404).json({ success: false, message: `No faculty found for "${kerberos}".` });
    }

    await cacheDelByPrefix(DIR_CACHE_PREFIX);

    const v = updated.metric_visibility || {};
    return successResponse(res, {
        metricVisibility: {
            h_index: v.h_index !== false,
            citations: v.citations !== false,
            papers: v.papers !== false,
            patents: v.patents !== false,
        },
    }, "Visibility updated.", 200);
});

export default directory;
