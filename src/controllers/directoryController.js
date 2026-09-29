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
        summaryOnly: req.query.summaryOnly,
        includeEmeritus: req.query.includeEmeritus
    });
    res.setHeader("X-Cache", cached ? "HIT" : "MISS");
    return successResponse(res, data, message, 200);
});

directory.getFacultiesForDepartmentGroup = asyncErrorHandler(async (req, res) => {
    const { data, message, cached } = await directoryService.getFacultiesForDepartmentGroup({
        departmentId: req.params.departmentId,
        category: req.query.category,
        includeEmeritus: req.query.includeEmeritus
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
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Trim, drop empties, dedupe (case-insensitive), and cap each string's length
// and the list size. Shared by qualifications / awards / custom research areas.
const cleanStringList = (value, { maxItems = 50, maxLen = 300 } = {}) => {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    const out = [];
    for (const raw of value) {
        const s = String(raw ?? "").trim().slice(0, maxLen);
        if (!s) continue;
        const key = s.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(s);
        if (out.length >= maxItems) break;
    }
    return out;
};

// Turn a faculty-entered link into a safe absolute http(s) URL, or "" if it
// can't be. A bare host ("lab.example.com") gets https://; other schemes
// (javascript:, data:, mailto:, ...) are rejected. "host:8080/x" is NOT a scheme.
const normalizeLinkUrl = (raw) => {
    const value = String(raw ?? "").trim().slice(0, 500);
    if (!value) return "";
    if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(value) && !/^https?:\/\//i.test(value)) return "";
    const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    try {
        const u = new URL(candidate);
        if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".")) return "";
        return candidate;
    } catch {
        return "";
    }
};

// [{label, url}] cleaned + validated. Rows with an empty URL are dropped (blank
// form rows); a non-empty but invalid URL is an error (never silently lost).
// A missing label falls back to the site's hostname. Deduped by URL, max 10.
const cleanExternalLinks = (value) => {
    if (!Array.isArray(value)) return { links: [] };
    const seen = new Set();
    const links = [];
    for (const item of value) {
        const rawUrl = String(item?.url ?? "").trim();
        if (!rawUrl) continue;
        const url = normalizeLinkUrl(rawUrl);
        if (!url) return { error: `"${rawUrl.slice(0, 60)}" is not a valid web link. Use a full address like https://example.com.` };
        if (seen.has(url.toLowerCase())) continue;
        seen.add(url.toLowerCase());
        const label = String(item?.label ?? "").trim().slice(0, 60)
            || new URL(url).hostname.replace(/^www\./i, "");
        links.push({ label, url });
        if (links.length >= 10) break;
    }
    return { links };
};

// The owner-facing shape shared by the GET and PATCH profile-extras responses.
const profileExtrasPayload = (doc) => ({
    background: doc.background || "",
    qualifications: Array.isArray(doc.qualifications) ? doc.qualifications : [],
    backgroundVisible: doc.background_visible === true,
    qualificationsVisible: doc.qualifications_visible === true,
    awards: Array.isArray(doc.awards) ? doc.awards : [],
    awardsVisible: doc.awards_visible === true,
    customResearchAreas: Array.isArray(doc.custom_research_areas) ? doc.custom_research_areas : [],
    additionalEmails: Array.isArray(doc.additional_emails) ? doc.additional_emails : [],
    phone: doc.phone || "",
    phoneVisible: doc.phone_visible === true,
    officeAddress: doc.office_address || "",
    officeAddressVisible: doc.office_address_visible === true,
    externalLinks: Array.isArray(doc.external_links)
        ? doc.external_links.map((l) => ({ label: l.label || "", url: l.url }))
        : [],
    externalLinksVisible: doc.external_links_visible === true,
    // The primary (kerberos) email is surfaced read-only so the edit UI can
    // show it as non-removable alongside the additional ones.
    primaryEmail: doc.email || "",
});

// Faculty self-service: read one's OWN editable profile sections (background,
// qualifications, awards, contact, links, ...) for editing. Owner-only. Unlike
// the public profile read, this returns the full content even when a section is
// hidden, so the owner can edit hidden text in edit mode. The public
// /faculty/:kerberos/profile read redacts hidden content.
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

    return successResponse(res, profileExtrasPayload(faculty), "Profile extras fetched.", 200);
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

    // The primary (kerberos) email must never be removed or duplicated — the DB
    // keys off it. Fetch it so we can strip it from any additional-email list.
    const existing = await resolveFacultyByKerberos(kerberos);
    if (!existing) {
        return res.status(404).json({ success: false, message: `No faculty found for "${kerberos}".` });
    }
    const primaryEmail = String(existing.email || "").toLowerCase();

    const body = req.body || {};
    const background = typeof body.background === "string" ? body.background : "";
    const qualifications = cleanStringList(body.qualifications);
    const backgroundVisible = body.background_visible === true;
    const qualificationsVisible = body.qualifications_visible === true;

    const awards = cleanStringList(body.awards);
    const awardsVisible = body.awards_visible === true;

    const customResearchAreas = cleanStringList(body.custom_research_areas, { maxItems: 20, maxLen: 120 });

    // Additional emails: valid, deduped, and never the primary kerberos email.
    const additionalEmails = [];
    if (Array.isArray(body.additional_emails)) {
        const seen = new Set([primaryEmail]);
        for (const raw of body.additional_emails) {
            const e = String(raw ?? "").trim();
            if (!e || !EMAIL_RE.test(e) || seen.has(e.toLowerCase())) continue;
            seen.add(e.toLowerCase());
            additionalEmails.push(e);
            if (additionalEmails.length >= 10) break;
        }
    }

    const phone = typeof body.phone === "string" ? body.phone.trim().slice(0, 40) : "";
    const phoneVisible = body.phone_visible === true;
    const officeAddress = typeof body.office_address === "string" ? body.office_address.trim().slice(0, 300) : "";
    const officeAddressVisible = body.office_address_visible === true;

    const externalLinksVisible = body.external_links_visible === true;
    const { links: externalLinks, error: externalLinksError } = cleanExternalLinks(body.external_links);
    if (externalLinksError) {
        return res.status(400).json({ success: false, message: externalLinksError });
    }

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
    if (awardsVisible && awards.length === 0) {
        return res.status(400).json({
            success: false,
            message: "Add at least one award to show this section.",
        });
    }
    if (phoneVisible && !phone) {
        return res.status(400).json({
            success: false,
            message: "Add a contact number to show it.",
        });
    }
    if (officeAddressVisible && !officeAddress) {
        return res.status(400).json({
            success: false,
            message: "Add an office address to show it.",
        });
    }
    if (externalLinksVisible && externalLinks.length === 0) {
        return res.status(400).json({
            success: false,
            message: "Add at least one link to show this section.",
        });
    }

    const updated = await updateFacultyProfileExtrasByKerberos(kerberos, {
        background,
        qualifications,
        background_visible: backgroundVisible,
        qualifications_visible: qualificationsVisible,
        awards,
        awards_visible: awardsVisible,
        custom_research_areas: customResearchAreas,
        additional_emails: additionalEmails,
        phone,
        phone_visible: phoneVisible,
        office_address: officeAddress,
        office_address_visible: officeAddressVisible,
        external_links: externalLinks,
        external_links_visible: externalLinksVisible,
    });
    if (!updated) {
        return res.status(404).json({ success: false, message: `No faculty found for "${kerberos}".` });
    }

    await cacheDelByPrefix(DIR_CACHE_PREFIX);

    return successResponse(res, profileExtrasPayload(updated), "Profile updated.", 200);
});

export default directory;
