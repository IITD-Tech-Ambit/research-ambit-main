import { BadRequestError, NotFoundError } from "../lib/customErrors.js";
import {
    isPossibleObjectId,
    buildSubjectAreaMap,
    formatDirectoryFaculty,
    collectKerberosInfo,
    isPublicDirectoryUnit
} from "../domain/facultyDirectory.js";
import { CACHE_TTL_S, cachedPayload, batchCacheKey, dirCacheKey } from "./directoryCache.js";
import * as repo from "./directoryRepository.js";

function collectDeptRefs(faculties) {
    const refs = [];
    for (const faculty of faculties) {
        if (faculty.department) refs.push(faculty.department);
        for (const affiliation of faculty.affiliations || []) refs.push(affiliation);
    }
    return refs
        .map((d) => (typeof d === "object" && d._id ? String(d._id) : String(d)))
        .filter((id) => isPossibleObjectId(id));
}

async function formatWithDepartments(faculties) {
    const uniqueDeptIds = [...new Set(collectDeptRefs(faculties))];
    const departmentDocs = uniqueDeptIds.length
        ? await repo.findDepartmentsByIds(uniqueDeptIds)
        : [];
    const departmentById = new Map(departmentDocs.map((d) => [String(d._id), d]));

    const { kerberosIds, expertIdToKerberos, expertIdToScopusIds } = collectKerberosInfo(faculties);
    const subjectMap = await buildSubjectAreaMap(kerberosIds, expertIdToKerberos, expertIdToScopusIds);

    return { departmentById, subjectMap };
}

function resolveDepartment(faculty, departmentById) {
    const deptRef = faculty.department;
    if (deptRef && typeof deptRef === "object" && typeof deptRef.name === "string") {
        return deptRef;
    }
    if (deptRef) {
        const key = typeof deptRef === "object" && deptRef._id ? String(deptRef._id) : String(deptRef);
        return departmentById.get(key) || null;
    }
    return null;
}

function resolveAffiliations(faculty, departmentById) {
    const homeId = faculty.department
        ? String(typeof faculty.department === "object" && faculty.department._id
            ? faculty.department._id
            : faculty.department)
        : null;
    const seen = new Set(homeId ? [homeId] : []);
    const units = [];
    for (const raw of faculty.affiliations || []) {
        const key = typeof raw === "object" && raw._id ? String(raw._id) : String(raw);
        if (seen.has(key)) continue;
        const doc = (typeof raw === "object" && raw.name) ? raw : departmentById.get(key);
        if (!doc || !isPublicDirectoryUnit(doc)) continue;
        seen.add(key);
        units.push(doc);
    }
    return units;
}

function formatFaculty(faculty, subjectMap, departmentById) {
    return formatDirectoryFaculty(faculty, subjectMap, {
        department: resolveDepartment(faculty, departmentById),
        affiliations: resolveAffiliations(faculty, departmentById)
    });
}

export const getFacultyByScopusId = async ({ scopusId } = {}) => {
    if (!scopusId || !String(scopusId).trim()) {
        throw new BadRequestError("No Scopus author id provided");
    }
    const sid = String(scopusId).trim();
    const faculty = await repo.findFacultyByScopusId(sid);
    if (!faculty) {
        throw new NotFoundError("Faculty not found for this Scopus id");
    }

    const { departmentById, subjectMap } = await formatWithDepartments([faculty]);
    const facultyResponse = formatFaculty(faculty, subjectMap, departmentById);

    return { data: facultyResponse, message: "Faculty fetched successfully", cached: false };
};

/**
 * Batch-resolve Scopus author ids → IITD Faculty profiles.
 * Response data: { matches: { [scopusId]: DirectoryFaculty } }; missing ids absent.
 */
export const resolveFacultiesByScopusIds = async ({ scopusIds } = {}) => {
    const raw = Array.isArray(scopusIds) ? scopusIds : [];
    const ids = [...new Set(
        raw
            .map((v) => (v == null ? "" : String(v).trim()))
            .filter((v) => v.length > 0)
    )];

    if (ids.length === 0) {
        return { data: { matches: {} }, message: "No Scopus ids provided", cached: false };
    }

    const cacheKey = batchCacheKey("by-scopus", ids);

    return cachedPayload(cacheKey, CACHE_TTL_S, async () => {
        const faculties = await repo.findFacultiesByScopusIds(ids);
        if (faculties.length === 0) {
            return { message: "No matching faculty", data: { matches: {} } };
        }

        const { departmentById, subjectMap } = await formatWithDepartments(faculties);

        const matches = {};
        for (const faculty of faculties) {
            const formatted = formatFaculty(faculty, subjectMap, departmentById);
            for (const sid of faculty.scopus_id || []) {
                const key = String(sid).trim();
                if (ids.includes(key)) {
                    matches[key] = formatted;
                }
            }
        }

        return { message: "Resolved", data: { matches } };
    });
};

/**
 * Batch-resolve kerberos ids → IITD Faculty profiles (max 100).
 * Response data: { matches: { [kerberos]: DirectoryFaculty } }; missing ids absent.
 */
export const resolveFacultiesByKerberos = async ({ kerberosIds } = {}) => {
    const raw = Array.isArray(kerberosIds) ? kerberosIds : [];
    const ids = [...new Set(
        raw
            .map((v) => (v == null ? "" : String(v).trim().toLowerCase()))
            .filter((v) => v.length > 0)
    )].slice(0, 100);

    if (ids.length === 0) {
        return { data: { matches: {} }, message: "No kerberos ids provided", cached: false };
    }

    const cacheKey = batchCacheKey("by-kerberos", ids);

    return cachedPayload(cacheKey, CACHE_TTL_S, async () => {
        const faculties = await repo.findFacultiesByKerberosIds(ids);
        if (faculties.length === 0) {
            return { message: "No matching faculty", data: { matches: {} } };
        }

        const { departmentById, subjectMap } = await formatWithDepartments(faculties);

        const matches = {};
        for (const faculty of faculties) {
            const kerberos = String(faculty.email || "").split("@")[0].toLowerCase();
            if (ids.includes(kerberos)) {
                matches[kerberos] = formatFaculty(faculty, subjectMap, departmentById);
            }
        }

        return { message: "Resolved", data: { matches } };
    });
};

export const getFacultiesById = async ({ id } = {}) => {
    if (!id) {
        throw new BadRequestError("No id provided");
    }
    const faculty = await repo.findFacultyById(id);
    if (!faculty) {
        throw new NotFoundError("Faculty not found");
    }

    const { departmentById, subjectMap } = await formatWithDepartments([faculty]);
    const facultyResponse = formatFaculty(faculty, subjectMap, departmentById);

    return { data: facultyResponse, message: "Faculty fetched successfully", cached: false };
};

export const getFacultyByKerberos = async ({ kerberos } = {}) => {
    if (!kerberos || !kerberos.trim()) {
        throw new BadRequestError("Kerberos id is required");
    }
    const k = kerberos.trim().toLowerCase();
    const cacheKey = dirCacheKey("faculty", "kerberos", k);

    return cachedPayload(cacheKey, CACHE_TTL_S, async () => {
        const faculty = await repo.resolveFacultyByKerberos(k);
        if (!faculty) {
            throw new NotFoundError("Faculty not found for this kerberos");
        }

        const { departmentById, subjectMap } = await formatWithDepartments([faculty]);
        const facultyResponse = formatFaculty(faculty, subjectMap, departmentById);

        // Profile-only sections (Background / Qualifications). Added here — NOT in
        // the shared formatDirectoryFaculty — so they never leak into directory
        // search/listings. Content is exposed only when the faculty has toggled the
        // section on; the value stays in the DB regardless. The owner's edit view
        // loads the full (incl. hidden) content via the authenticated profile-extras
        // endpoint, not this public read.
        const backgroundVisible = faculty.background_visible === true;
        const qualificationsVisible = faculty.qualifications_visible === true;
        facultyResponse.backgroundVisible = backgroundVisible;
        facultyResponse.qualificationsVisible = qualificationsVisible;
        facultyResponse.background = backgroundVisible ? (faculty.background || "") : null;
        facultyResponse.qualifications = qualificationsVisible ? (faculty.qualifications || []) : null;

        return { message: "Faculty fetched successfully", data: facultyResponse };
    });
};
