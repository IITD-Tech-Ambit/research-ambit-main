import fs from "fs";
import { asyncErrorHandler } from "../middleware/errorHandler.js";
import { successResponse } from "../lib/responseUtils.js";
import * as directoryService from "../services/directoryService.js";
import { updateFacultyImageByKerberos, updateFacultyVisibilityByKerberos, updateFacultyProfileExtrasByKerberos, resolveFacultyByKerberos } from "../services/directoryRepository.js";
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

const BACKGROUND_MIN_CHARS = 100;

// Faculty self-service: read one's OWN Background / Qualifications sections for
// editing. Owner-only. Unlike the public profile read, this returns the full
// content even when a section is hidden, so the owner can edit hidden text in
// edit mode. The public /faculty/:kerberos/profile read redacts hidden content.
directory.getFacultyProfileExtras = asyncErrorHandler(async (req, res) => {
    const kerberos = String(req.params.kerberos || "").toLowerCase();
    const authKerberos = String(req.headers["x-user-kerberos"] || "").toLowerCase();

    if (!authKerberos) {
        return res.status(401).json({ success: false, message: "Not authenticated." });
    }
    if (authKerberos !== kerberos) {
        return res.status(403).json({ success: false, message: "You can only edit your own profile." });
    }

    const faculty = await resolveFacultyByKerberos(kerberos);
    if (!faculty) {
        return res.status(404).json({ success: false, message: `No faculty found for "${kerberos}".` });
    }

    return successResponse(res, {
        background: faculty.background || "",
        qualifications: Array.isArray(faculty.qualifications) ? faculty.qualifications : [],
        backgroundVisible: faculty.background_visible === true,
        qualificationsVisible: faculty.qualifications_visible === true,
    }, "Profile extras fetched.", 200);
});

// Faculty self-service: save one's OWN Background / Qualifications sections and
// their visibility. Owner-only. Content is stored even when a section is hidden
// (kept in the DB so it can be shown again). Validation is enforced ONLY when a
// section is being shown: background >= 100 chars, qualifications >= 1 item.
// Flushes the directory cache so the change shows on the profile at once.
directory.updateFacultyProfileExtras = asyncErrorHandler(async (req, res) => {
    const kerberos = String(req.params.kerberos || "").toLowerCase();
    const authKerberos = String(req.headers["x-user-kerberos"] || "").toLowerCase();

    if (!authKerberos) {
        return res.status(401).json({ success: false, message: "Not authenticated." });
    }
    if (authKerberos !== kerberos) {
        return res.status(403).json({ success: false, message: "You can only edit your own profile." });
    }

    const body = req.body || {};
    const background = typeof body.background === "string" ? body.background : "";
    const qualifications = Array.isArray(body.qualifications)
        ? body.qualifications.map((q) => String(q).trim()).filter(Boolean)
        : [];
    const backgroundVisible = body.background_visible === true;
    const qualificationsVisible = body.qualifications_visible === true;

    // Enforce minimums only when the section is shown; hidden content is stored as-is.
    if (backgroundVisible && background.trim().length < BACKGROUND_MIN_CHARS) {
        return res.status(400).json({
            success: false,
            message: `Background must be at least ${BACKGROUND_MIN_CHARS} characters to show it.`,
        });
    }
    if (qualificationsVisible && qualifications.length === 0) {
        return res.status(400).json({
            success: false,
            message: "Add at least one qualification to show this section.",
        });
    }

    const updated = await updateFacultyProfileExtrasByKerberos(kerberos, {
        background,
        qualifications,
        background_visible: backgroundVisible,
        qualifications_visible: qualificationsVisible,
    });
    if (!updated) {
        return res.status(404).json({ success: false, message: `No faculty found for "${kerberos}".` });
    }

    await cacheDelByPrefix(DIR_CACHE_PREFIX);

    return successResponse(res, {
        background: updated.background || "",
        qualifications: Array.isArray(updated.qualifications) ? updated.qualifications : [],
        backgroundVisible: updated.background_visible === true,
        qualificationsVisible: updated.qualifications_visible === true,
    }, "Profile updated.", 200);
});

export default directory;
