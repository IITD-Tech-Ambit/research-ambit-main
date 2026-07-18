/**
 * Response mappers: service DTOs (camelCase / Mongoose-shaped, exactly what the
 * REST endpoints emit) -> directory.v1 proto messages (snake_case fields, per
 * the loader's keepCase:true). Optional fields are only set when the source
 * value is present, so the gateway can faithfully omit-vs-null them per the
 * proto's documented `optional` semantics. Anything the proto models as a
 * `*_json` string is handled by the handlers via JSON.stringify, not here.
 */

/** Set an optional field only when the value is meaningfully present. */
const setOpt = (target, key, value) => {
    if (value !== undefined && value !== null) target[key] = value;
};

const asId = (value) => (value === undefined || value === null ? "" : String(value));

/** normalizeDepartment output ({_id,name,code,category}) -> Department. */
export function mapDepartment(dept) {
    if (!dept) return null;
    const out = {};
    setOpt(out, "id", dept._id !== undefined && dept._id !== null ? String(dept._id) : undefined);
    setOpt(out, "name", dept.name);
    setOpt(out, "code", dept.code);
    setOpt(out, "category", dept.category);
    return out;
}

/** formatDirectoryFacultyCards element -> FacultyCard. */
export function mapFacultyCard(card) {
    const out = {
        id: asId(card._id),
        name: card.name || "",
        email: card.email || "",
        citation_count: card.citationCount ?? 0,
        h_index: card.hIndex ?? 0,
        research_areas: Array.isArray(card.research_areas) ? card.research_areas : [],
    };
    const dept = mapDepartment(card.department);
    if (dept) out.department = dept;
    setOpt(out, "profile_image_url", card.profileImageUrl);
    setOpt(out, "designation", card.designation);
    return out;
}

/** formatDirectoryFaculty output -> Faculty (detail). */
export function mapFaculty(f) {
    if (!f) return null;
    const out = {
        id: asId(f._id),
        name: f.name || "",
        email: f.email || "",
        citation_count: f.citationCount ?? 0,
        h_index: f.hIndex ?? 0,
        research_areas: Array.isArray(f.research_areas) ? f.research_areas : [],
        tags: Array.isArray(f.tags) ? f.tags : [],
    };
    setOpt(out, "orc_id", f.orcId);
    setOpt(out, "scopus_id", f.scopusId);
    setOpt(out, "google_scholar_id", f.googleScholarId);
    const dept = mapDepartment(f.department);
    if (dept) out.department = dept;
    setOpt(out, "profile_image_url", f.profileImageUrl);
    setOpt(out, "designation", f.designation);
    setOpt(out, "working_from_year", f.workingFromYear);
    return out;
}

/** REST pagination object -> Pagination. */
export function mapPagination(p) {
    if (!p) return undefined;
    return {
        page: p.page ?? 0,
        limit: p.limit ?? 0,
        total: p.total ?? 0,
        total_pages: p.totalPages ?? 0,
        has_next: !!p.hasNext,
        has_prev: !!p.hasPrev,
    };
}

/** map<string, Faculty> for the batch-resolve RPCs. */
export function mapFacultyMatches(matches) {
    const out = {};
    for (const [key, value] of Object.entries(matches || {})) {
        out[key] = mapFaculty(value);
    }
    return out;
}

/** Bare Department docs ({_id,name,code,category}) -> Department[] (search departments). */
export function mapDepartments(list) {
    return (Array.isArray(list) ? list : []).map((d) =>
        mapDepartment({ _id: d._id, name: d.name, code: d.code, category: d.category }),
    );
}
