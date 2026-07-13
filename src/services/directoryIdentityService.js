import { BadRequestError, NotFoundError } from "../lib/customErrors.js";
import {
    findDepartmentByReference,
    isPossibleObjectId,
    buildSubjectAreaMap,
    formatDirectoryFaculty,
    collectKerberosInfo
} from "../domain/facultyDirectory.js";
import { CACHE_TTL_S, cachedPayload, batchCacheKey } from "./directoryCache.js";
import * as repo from "./directoryRepository.js";

async function formatWithDepartments(faculties) {
    const deptIds = faculties
        .map((f) => f.department)
        .filter(Boolean)
        .map((d) => (typeof d === "object" && d._id ? String(d._id) : String(d)))
        .filter((id) => isPossibleObjectId(id));
    const uniqueDeptIds = [...new Set(deptIds)];
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

export const getFacultyByScopusId = async ({ scopusId } = {}) => {
    if (!scopusId || !String(scopusId).trim()) {
        throw new BadRequestError("No Scopus author id provided");
    }
    const sid = String(scopusId).trim();
    const faculty = await repo.findFacultyByScopusId(sid);
    if (!faculty) {
        throw new NotFoundError("Faculty not found for this Scopus id");
    }

    const department = await findDepartmentByReference(faculty.department);
    const { kerberosIds: bsKids, expertIdToKerberos: bsE2k, expertIdToScopusIds: bsS2k } = collectKerberosInfo([faculty]);
    const subjectMap = await buildSubjectAreaMap(bsKids, bsE2k, bsS2k);
    const facultyResponse = formatDirectoryFaculty(faculty, subjectMap, { department });

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
            const department = resolveDepartment(faculty, departmentById);
            const formatted = formatDirectoryFaculty(faculty, subjectMap, { department });
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
                matches[kerberos] = formatDirectoryFaculty(
                    faculty,
                    subjectMap,
                    { department: resolveDepartment(faculty, departmentById) }
                );
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

    const department = await findDepartmentByReference(faculty.department);
    const { kerberosIds: fbKids, expertIdToKerberos: fbE2k, expertIdToScopusIds: fbS2k } = collectKerberosInfo([faculty]);
    const subjectMap = await buildSubjectAreaMap(fbKids, fbE2k, fbS2k);
    const facultyResponse = formatDirectoryFaculty(faculty, subjectMap, { department });

    return { data: facultyResponse, message: "Faculty fetched successfully", cached: false };
};

export const getFacultyByKerberos = async ({ kerberos } = {}) => {
    if (!kerberos || !kerberos.trim()) {
        throw new BadRequestError("Kerberos id is required");
    }
    const k = kerberos.trim().toLowerCase();
    const cacheKey = `dir:faculty:kerberos:${k}`;

    return cachedPayload(cacheKey, CACHE_TTL_S, async () => {
        const faculty = await repo.resolveFacultyByKerberos(k);
        if (!faculty) {
            throw new NotFoundError("Faculty not found for this kerberos");
        }

        const department = await findDepartmentByReference(faculty.department);
        const { kerberosIds: fkKids, expertIdToKerberos: fkE2k, expertIdToScopusIds: fkS2k } = collectKerberosInfo([faculty]);
        const subjectMap = await buildSubjectAreaMap(fkKids, fkE2k, fkS2k);
        const facultyResponse = formatDirectoryFaculty(faculty, subjectMap, { department });

        return { message: "Faculty fetched successfully", data: facultyResponse };
    });
};
