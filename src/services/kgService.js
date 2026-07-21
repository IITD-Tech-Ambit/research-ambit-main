/**
 * Knowledge-graph application service: transport-agnostic logic behind
 * /api/kg/*. Shared by the REST controllers and the directory.v1
 * KnowledgeGraphService gRPC handlers so there is ONE implementation.
 *
 * All KG data now lives in MongoDB (see models/knowledgeGraph.js + the build
 * pipeline) instead of the data/knowledge-graph/ filesystem. Reads go through
 * kgRepository, which resolves the immutable active build `version` and caches
 * small structures in Redis + hot binary tiles in an in-process LRU. Functions
 * return the `data` payload plus a `cached` flag; the atlas tile is special
 * (raw bytes + ETag).
 */
import { NotFoundError } from "../lib/customErrors.js";
import {
  kgCacheGet,
  kgCacheKey,
  kgCacheSet,
  KG_CACHE_TTL_S,
} from "../lib/kgCache.js";
import { ensureRedisConnected, redisClient } from "../lib/redis.js";
import * as repo from "./kgRepository.js";
import ResearchMetaDataScopus from "../models/research_scopus.js";
import Faculty from "../models/faculty.js";

const kerberosFromEmail = (email) => {
  const e = String(email || "").trim().toLowerCase();
  if (!e.includes("@")) return "";
  return e.split("@")[0];
};

const escapeRegex = (input = "") => input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Resolve active version or fail with a clear NotFound (data not published). */
async function activeVersionOrThrow() {
  const version = await repo.getActiveVersion();
  if (!version) {
    throw new NotFoundError(
      "Atlas not published. Run knowledge-graph/pipeline/build_atlas_tiles.py.",
    );
  }
  return version;
}

/** initKg warms the active-version cache and pre-builds the legacy `/atlas`
 * body into Redis at boot, so the expensive scan lands at deploy time
 * instead of on the first visitor. Best-effort, non-blocking. */
export function initKg() {
  repo
    .getActiveVersion()
    .then((version) => (version ? warmAtlasCache(version) : null))
    .catch(() => {});
}

/** Pre-build and cache the full legacy atlas body for `version`, if it isn't
 * already cached. Safe to call repeatedly (no-ops once warm). */
export async function warmAtlasCache(version) {
  const cacheKey = kgCacheKey(version, "atlas-legacy-body");
  const existing = await kgCacheGet(cacheKey);
  if (existing) return;
  await buildAndCacheAtlasBody(version, cacheKey);
}

async function buildAndCacheAtlasBody(version, cacheKey) {
  const meta = await repo.getVersionMeta(version);
  // Full scan — only the legacy fallback path pays this cost, and only once
  // per version now that initKg() warms it eagerly at boot.
  const { AtlasPoint } = await import("../models/knowledgeGraph.js");
  const all = await AtlasPoint.find({ version }, { _id: 0, version: 0 }).lean();
  const body = JSON.stringify({
    version: 2,
    count: all.length,
    themes: meta?.dict?.themes ?? [],
    papers: all.map((p) => ({
      i: p.i, id: p.id, title: p.title, theme: p.theme, domain: p.domain,
      subdomain: p.subdomain, topic: p.topic, department: p.department,
      citations: p.citations ?? 0, x: p.x, y: p.y, z: p.z,
    })),
  });
  await kgCacheSet(cacheKey, body);
  return body;
}

// Caches only the raw `data`; the envelope is rebuilt per transport so REST and
// gRPC share it. Keyed by the immutable build version => never stale.
async function cachedData(key, loadData) {
  const cached = await kgCacheGet(key);
  if (cached) {
    return { data: JSON.parse(cached), cached: true };
  }
  const data = await loadData();
  await kgCacheSet(key, JSON.stringify(data));
  return { data, cached: false };
}

export async function getHealth() {
  let redisConnected = false;
  try {
    if (await ensureRedisConnected()) {
      await redisClient.ping();
      redisConnected = true;
    }
  } catch {
    redisConnected = false;
  }

  const version = await repo.getActiveVersion();
  const meta = version ? await repo.getVersionMeta(version) : null;
  const graphsIndex = version ? await repo.getIndexDoc(version, "faculty-search-index") : null;
  const exploreReady = version ? await repo.hasExploreTerms(version) : false;

  return {
    data: {
      graphsReady: Array.isArray(graphsIndex) && graphsIndex.length > 0,
      exploreReady,
      atlasReady: !!meta,
      atlasCount: meta?.pointCount ?? 0,
      dataDir: version ? `mongodb:${version}` : "mongodb",
      redisConnected,
      cacheTtlSeconds: KG_CACHE_TTL_S,
    },
    cached: false,
  };
}

export async function getFacultyIndex() {
  const version = await activeVersionOrThrow();
  const key = kgCacheKey(version, "faculty-index");
  return cachedData(key, async () => {
    const data = await repo.getIndexDoc(version, "faculty-search-index");
    if (!data) throw new NotFoundError("Faculty index not found. Run the KG pipeline first.");
    return data;
  });
}

export async function getFacultyGraph({ id } = {}) {
  const version = await activeVersionOrThrow();
  const safeId = String(id).replace(/[^a-zA-Z0-9_-]/g, "");
  const key = kgCacheKey(version, "faculty-graph", safeId);
  return cachedData(key, async () => {
    const graph = await repo.getFacultyGraphDoc(version, safeId);
    if (!graph) throw new NotFoundError(`No knowledge graph for faculty '${safeId}'.`);
    return graph;
  });
}

export async function getExploreTerms({ q, type, limit } = {}) {
  const version = await activeVersionOrThrow();
  const query = String(q ?? "").trim().toLowerCase();
  const t = String(type ?? "").trim();
  const l = Math.min(Number(limit) || 40, 200);
  const key = kgCacheKey(version, "explore-terms", query, t, l);

  return cachedData(key, async () => {
    const filter = {};
    if (t) filter.type = t;
    if (query) {
      filter.term = { $regex: escapeRegex(query), $options: "i" };
    } else if (!t) {
      filter.type = { $in: ["theme", "domain", "subdomain"] };
    }
    return repo.findExploreTerms(version, filter, l);
  });
}

export async function getExploreDetail({ key } = {}) {
  const version = await activeVersionOrThrow();
  const keyParam = String(key ?? "");
  const cacheKey = kgCacheKey(version, "explore-detail", keyParam);
  return cachedData(cacheKey, async () => {
    const detail = await repo.findExploreDetail(version, keyParam);
    if (!detail) throw new NotFoundError(`No explore detail for key '${keyParam}'.`);
    return detail;
  });
}

/** Paper metadata + full detail for Research Atlas click panel (Mongo papers). */
export async function getPaperMeta({ id } = {}) {
  const rawId = String(id).replace(/[^a-fA-F0-9]/g, "");
  if (!rawId) {
    throw new NotFoundError("Invalid paper id.");
  }

  const key = kgCacheKey("paper-meta", rawId);
  return cachedData(key, async () => {
    const paper = await ResearchMetaDataScopus.findById(rawId)
      .select(
        "link document_scopus_id document_eid title abstract publication_year citation_count reference_count authors subject_area field_associated document_type kerberos",
      )
      .lean();
    if (!paper) {
      throw new NotFoundError(`No paper found for id '${rawId}'.`);
    }

    const authorIds = [
      ...new Set(
        (paper.authors ?? [])
          .map((a) => String(a.author_id ?? "").trim())
          .filter(Boolean),
      ),
    ];
    const kerberos = String(paper.kerberos ?? "").trim().toLowerCase();

    const facultyClauses = [];
    if (authorIds.length) {
      facultyClauses.push({ scopus_id: { $in: authorIds } });
    }
    if (kerberos) {
      facultyClauses.push({
        email: { $regex: `^${escapeRegex(kerberos)}@`, $options: "i" },
      });
    }

    let iitdFaculty = [];
    if (facultyClauses.length) {
      const facDocs = await Faculty.find({ $or: facultyClauses })
        .select("title firstName lastName email department scopus_id")
        .populate("department", "name")
        .lean();

      const seen = new Set();
      for (const f of facDocs) {
        const facultyId = String(f._id);
        if (seen.has(facultyId)) continue;
        seen.add(facultyId);
        iitdFaculty.push({
          facultyId,
          name: [f.title, f.firstName, f.lastName].filter(Boolean).join(" ").trim(),
          department: f.department?.name ?? "",
          kerberos: kerberosFromEmail(f.email),
        });
      }
    }

    return {
      link: paper.link ?? "",
      document_scopus_id: paper.document_scopus_id ?? "",
      document_eid: paper.document_eid ?? "",
      title: paper.title ?? "",
      abstract: paper.abstract ?? "",
      publication_year: paper.publication_year ?? null,
      citation_count: paper.citation_count ?? 0,
      reference_count: paper.reference_count ?? 0,
      document_type: paper.document_type ?? "",
      field_associated: paper.field_associated ?? "",
      subject_area: paper.subject_area ?? [],
      authors: (paper.authors ?? []).map((a) => ({
        name: a.author_name ?? "",
        author_id: a.author_id ?? "",
        position: a.author_position ?? "",
      })),
      iitd_faculty: iitdFaculty,
    };
  });
}

/** Headers-only octree hierarchy for the streaming client. */
export async function getAtlasTree() {
  const version = await activeVersionOrThrow();
  const meta = await repo.getVersionMeta(version);
  if (!meta?.tree) throw new NotFoundError("Atlas tree not found.");
  return {
    data: { version, pointCount: meta.pointCount ?? 0, ...meta.tree },
    cached: false,
  };
}

/** Taxonomy id dictionary + precomputed label anchors. */
export async function getAtlasDict() {
  const version = await activeVersionOrThrow();
  const meta = await repo.getVersionMeta(version);
  if (!meta?.dict) throw new NotFoundError("Atlas dict not found.");
  return { data: { version, ...meta.dict }, cached: false };
}

/** One octree node's quantized binary tile. Returns { version, etag, payload }. */
export async function getAtlasTile({ nodeKey } = {}) {
  const version = await activeVersionOrThrow();
  const safeKey = String(nodeKey ?? "r").replace(/[^a-zA-Z0-9-]/g, "");
  const { payload } = await repo.getTile(version, safeKey);
  if (!payload) {
    throw new NotFoundError(`No atlas tile '${safeKey}'.`);
  }
  // Tiles are immutable per version, so the version+key is a perfect ETag.
  return { version, nodeKey: safeKey, etag: `"${version}-${safeKey}"`, payload };
}

/** Exact coords for a set of atlas indices (highlight overlay). */
export async function getAtlasPoints({ indices } = {}) {
  const version = await activeVersionOrThrow();
  const list = (Array.isArray(indices) ? indices : [])
    .map((n) => Number(n))
    .filter((n) => Number.isInteger(n) && n >= 0)
    .slice(0, 70000);
  if (!list.length) return { data: { points: [] }, cached: false };
  const rows = await repo.getPointsByIndices(version, list);
  return {
    data: {
      points: rows.map((r) => ({
        i: r.i,
        id: r.id ?? "",
        title: r.title ?? "",
        theme: r.theme ?? "",
        domain: r.domain ?? "",
        department: r.department ?? "",
        x: r.x,
        y: r.y,
        z: r.z,
      })),
    },
    cached: false,
  };
}

/**
 * Legacy full atlas payload rebuilt from atlas_points (back-compat for the old
 * renderer behind the feature flag). Removed at cutover; the tile pipeline is
 * the supported path. ETag = active version.
 */
export async function getAtlas({ ifNoneMatch } = {}) {
  const version = await activeVersionOrThrow();
  const etag = `"${version}"`;
  if (ifNoneMatch === etag) {
    return { notModified: true, etag, body: null, cached: false };
  }
  const cacheKey = kgCacheKey(version, "atlas-legacy-body");
  const cached = await kgCacheGet(cacheKey);
  if (cached) return { notModified: false, etag, body: cached, cached: true };

  const body = await buildAndCacheAtlasBody(version, cacheKey);
  return { notModified: false, etag, body, cached: false };
}

/** Full-text atlas search (Mongo text index). Returns matching indices. */
export async function searchAtlas({ q, limit } = {}) {
  const version = await activeVersionOrThrow();
  const query = String(q ?? "").trim();
  const l = Math.min(Number(limit) || 5000, 70000);
  if (!query) {
    return { data: { query: "", matchCount: 0, indices: [] }, cached: false };
  }
  const key = kgCacheKey(version, "atlas-search-and", query.toLowerCase(), l);
  return cachedData(key, async () => {
    const rows = await repo.searchAtlasPoints(version, query, l);
    return { query, matchCount: rows.length, indices: rows.map((r) => r.i) };
  });
}

/**
 * Authoritative atlas indices for a primary/base query. Exact department or
 * faculty names use KG indexes (faculty-linked papers), not title text search.
 */
async function resolveBaseAtlasIndices(version, baseQuery, baseEntityKind = "", limit = 70000) {
  const q = String(baseQuery ?? "").trim();
  const kind = String(baseEntityKind ?? "").trim().toLowerCase();
  const l = Math.min(Number(limit) || 70000, 70000);
  if (!q) return { indices: [], baseCount: 0, cached: false };

  if (kind === "department") {
    const dept = await getDepartmentAtlasIndices({ departments: [q] });
    const indices = dept.data?.indices ?? [];
    return { indices, baseCount: indices.length, cached: dept.cached };
  }
  if (kind === "faculty") {
    const fac = await searchAtlasFaculty({ q, limit: 20 }).catch(() => ({
      data: { indices: [], matches: [] },
      cached: false,
    }));
    const exact = (fac.data?.matches ?? []).filter(
      (f) => String(f.name || "").trim().toLowerCase() === q.toLowerCase(),
    );
    const use = exact.length ? exact : (fac.data?.matches ?? []).slice(0, 3);
    if (use.length) {
      const ids = use.map((f) => f.facultyId).filter(Boolean);
      const idxRes = await getFacultyAtlasIndices({ ids }).catch(() => null);
      const indices = idxRes?.data?.indices?.length
        ? idxRes.data.indices
        : (fac.data?.indices ?? []);
      return { indices, baseCount: indices.length, cached: fac.cached };
    }
  }

  const deptProbe = await searchAtlasDepartment({ q, limit: 5 }).catch(() => null);
  const exactDept = (deptProbe?.data?.matches ?? []).find(
    (d) => String(d.department || "").trim().toLowerCase() === q.toLowerCase(),
  );
  if (exactDept) {
    const dept = await getDepartmentAtlasIndices({ departments: [exactDept.department] });
    const indices = dept.data?.indices ?? [];
    return { indices, baseCount: indices.length, cached: dept.cached };
  }

  const facProbe = await searchAtlasFaculty({ q, limit: 5 }).catch(() => null);
  const exactFac = (facProbe?.data?.matches ?? []).find(
    (f) => String(f.name || "").trim().toLowerCase() === q.toLowerCase(),
  );
  if (exactFac?.facultyId) {
    const idxRes = await getFacultyAtlasIndices({ ids: [exactFac.facultyId] }).catch(() => null);
    const indices = idxRes?.data?.indices?.length
      ? idxRes.data.indices
      : (facProbe?.data?.indices ?? []);
    return { indices, baseCount: indices.length, cached: facProbe?.cached ?? false };
  }

  const base = await searchAtlas({ q, limit: l });
  const indices = base.data?.indices ?? [];
  return {
    indices,
    baseCount: base.data?.matchCount ?? indices.length,
    cached: base.cached,
  };
}

/**
 * Nested / refine-within search: papers that match `baseQ` AND also match
 * the refine term via text, department, or faculty/department indexes.
 * Resolves the full base set server-side (up to 70k) so nested results are
 * not limited by the client's overlay cap.
 */
export async function searchAtlasRefine({ baseQ, q, limit, entity, baseEntity } = {}) {
  const version = await activeVersionOrThrow();
  const baseQuery = String(baseQ ?? "").trim();
  const refineQuery = String(q ?? "").trim();
  const entityKind = String(entity ?? "").trim().toLowerCase(); // "" | "department" | "faculty"
  const l = Math.min(Number(limit) || 8000, 70000);

  if (!baseQuery) {
    return {
      data: {
        baseQuery: "",
        query: refineQuery,
        baseCount: 0,
        matchCount: 0,
        indices: [],
        points: [],
      },
      cached: false,
    };
  }

  const baseEntityKind = String(baseEntity ?? "").trim().toLowerCase();

  if (!refineQuery) {
    const base = await resolveBaseAtlasIndices(version, baseQuery, baseEntityKind, l);
    const indices = base.indices ?? [];
    const points = await repo.getPointsByIndices(version, indices);
    return {
      data: {
        baseQuery,
        query: "",
        baseCount: base.baseCount ?? indices.length,
        matchCount: indices.length,
        indices,
        points: points.map((p) => ({
          i: p.i,
          id: p.id || "",
          title: p.title || "",
          theme: p.theme || "",
          domain: p.domain || "",
          department: p.department || "",
          x: p.x,
          y: p.y,
          z: p.z,
        })),
      },
      cached: base.cached,
    };
  }

  const key = kgCacheKey(
    version,
    "atlas-refine-v3",
    baseQuery.toLowerCase(),
    refineQuery.toLowerCase(),
    entityKind || "any",
    baseEntityKind || "auto",
    l,
  );
  return cachedData(key, async () => {
    // Resolve the authoritative base set (not capped at the UI overlay size).
    const base = await resolveBaseAtlasIndices(version, baseQuery, baseEntityKind, 70000);
    const baseIndices = base.indices ?? [];
    const baseSet = new Set(baseIndices);
    const baseCount = base.baseCount ?? baseIndices.length;

    if (!baseIndices.length) {
      return {
        baseQuery,
        query: refineQuery,
        baseCount: 0,
        matchCount: 0,
        indices: [],
        points: [],
      };
    }

    const refineSet = new Set();

    // Department / faculty picks must NOT fall through to token text search —
    // otherwise "Chemical Engineering" matches titles with "Electrochemical"
    // and domains containing "Engineering" (e.g. Civil papers).
    let kind = entityKind;
    if (!kind) {
      const deptProbe = await searchAtlasDepartment({ q: refineQuery, limit: 5 }).catch(() => null);
      const exactDept = (deptProbe?.data?.matches ?? []).find(
        (d) => String(d.department || "").trim().toLowerCase() === refineQuery.toLowerCase(),
      );
      if (exactDept) kind = "department";
      else {
        const facProbe = await searchAtlasFaculty({ q: refineQuery, limit: 5 }).catch(() => null);
        const exactFac = (facProbe?.data?.matches ?? []).find(
          (f) => String(f.name || "").trim().toLowerCase() === refineQuery.toLowerCase(),
        );
        if (exactFac) kind = "faculty";
      }
    }

    if (kind === "department") {
      const [deptRows, dept] = await Promise.all([
        repo.findPointsByDepartmentWithin(version, refineQuery, baseIndices, l),
        searchAtlasDepartment({ q: refineQuery, limit: 50 }).catch(() => ({
          data: { indices: [], matches: [] },
        })),
      ]);
      // Prefer exact department name matches from the index when available.
      const exactMatches = (dept.data?.matches ?? []).filter(
        (d) => String(d.department || "").trim().toLowerCase() === refineQuery.toLowerCase(),
      );
      if (exactMatches.length) {
        const deptIndex = await repo.getIndexDoc(version, "department-atlas-indices");
        for (const m of exactMatches) {
          for (const idx of deptIndex?.[m.department]?.indices ?? []) {
            if (baseSet.has(idx)) refineSet.add(idx);
          }
        }
      } else {
        for (const row of deptRows) refineSet.add(row.i);
        for (const i of dept.data?.indices ?? []) {
          if (baseSet.has(i)) refineSet.add(i);
        }
      }
    } else if (kind === "faculty") {
      const fac = await searchAtlasFaculty({ q: refineQuery, limit: 50 }).catch(() => ({
        data: { indices: [], matches: [] },
      }));
      const exact = (fac.data?.matches ?? []).filter(
        (f) => String(f.name || "").trim().toLowerCase() === refineQuery.toLowerCase(),
      );
      const useMatches = exact.length ? exact : (fac.data?.matches ?? []).slice(0, 3);
      if (useMatches.length) {
        const ids = useMatches.map((f) => f.facultyId).filter(Boolean);
        const idxRes = await getFacultyAtlasIndices({ ids }).catch(() => null);
        for (const i of idxRes?.data?.indices ?? fac.data?.indices ?? []) {
          if (baseSet.has(i)) refineSet.add(i);
        }
      } else {
        for (const i of fac.data?.indices ?? []) {
          if (baseSet.has(i)) refineSet.add(i);
        }
      }
    } else {
      const [textRows, deptRows, fac, dept] = await Promise.all([
        repo.searchAtlasPointsWithin(version, refineQuery, baseIndices, l),
        repo.findPointsByDepartmentWithin(version, refineQuery, baseIndices, l),
        searchAtlasFaculty({ q: refineQuery, limit: 50 }).catch(() => ({
          data: { indices: [], matches: [] },
        })),
        searchAtlasDepartment({ q: refineQuery, limit: 50 }).catch(() => ({
          data: { indices: [], matches: [] },
        })),
      ]);

      for (const row of textRows) refineSet.add(row.i);
      for (const row of deptRows) refineSet.add(row.i);
      for (const i of fac.data?.indices ?? []) {
        if (baseSet.has(i)) refineSet.add(i);
      }
      for (const i of dept.data?.indices ?? []) {
        if (baseSet.has(i)) refineSet.add(i);
      }
    }

    const indices = [...refineSet].slice(0, l);
    let points = indices.length
      ? await repo.getPointsByIndices(version, indices)
      : [];

    // Hard filter: drop papers explicitly tagged to a different department.
    // Keep untagged papers that came from the department index.
    if (kind === "department") {
      const want = refineQuery.toLowerCase();
      points = points.filter((p) => {
        const d = String(p.department || "").trim().toLowerCase();
        if (!d) return true;
        return d === want || d.includes(want) || want.includes(d);
      });
    }

    const finalIndices = kind === "department" ? points.map((p) => p.i) : indices;

    return {
      baseQuery,
      query: refineQuery,
      baseCount,
      matchCount: finalIndices.length,
      indices: finalIndices,
      points: points.map((p) => ({
        i: p.i,
        id: p.id || "",
        title: p.title || "",
        theme: p.theme || "",
        domain: p.domain || "",
        department: p.department || "",
        x: p.x,
        y: p.y,
        z: p.z,
      })),
    };
  });
}

/** Paper atlas indices for one or more faculty (by id). */
export async function getFacultyAtlasIndices({ ids } = {}) {
  const version = await activeVersionOrThrow();
  const indicesMap = await repo.getIndexDoc(version, "faculty-atlas-indices");
  if (!indicesMap) {
    throw new NotFoundError("Faculty atlas index not available. Run the KG pipeline first.");
  }
  const rawIds = (Array.isArray(ids) ? ids : [])
    .map((id) => String(id).trim().replace(/[^a-zA-Z0-9_-]/g, ""))
    .filter(Boolean);
  if (!rawIds.length) {
    return { data: { facultyIds: [], matchCount: 0, indices: [] }, cached: false };
  }

  const key = kgCacheKey(version, "faculty-atlas-indices", rawIds.join(","));
  return cachedData(key, async () => {
    const indices = new Set();
    for (const id of rawIds) {
      for (const idx of indicesMap[id] ?? []) indices.add(idx);
    }
    return { facultyIds: rawIds, matchCount: indices.size, indices: [...indices] };
  });
}

function nameMatches(name, query, tokens) {
  const hay = String(name || "").toLowerCase();
  if (!hay) return false;
  if (hay.includes(query)) return true;
  if (tokens.length > 1) return tokens.every((t) => hay.includes(t));
  return false;
}

/** Search faculty by name; returns matches + their atlas paper indices. */
export async function searchAtlasFaculty({ q, limit } = {}) {
  const version = await activeVersionOrThrow();
  const indicesMap = await repo.getIndexDoc(version, "faculty-atlas-indices");
  const searchIndex = await repo.getIndexDoc(version, "faculty-search-index");
  if (!indicesMap || !searchIndex) {
    throw new NotFoundError("Faculty atlas index not available. Run the KG pipeline first.");
  }
  const query = String(q ?? "").trim().toLowerCase();
  const l = Math.min(Number(limit) || 12, 50);
  if (!query) {
    return { data: { query: "", matches: [], matchCount: 0, indices: [] }, cached: false };
  }

  const key = kgCacheKey(version, "faculty-atlas-search", query, l);
  return cachedData(key, async () => {
    const tokens = query.split(/\s+/).filter((token) => token.length >= 2);
    const matched = searchIndex
      .filter((f) => nameMatches(f.name, query, tokens))
      .sort((a, b) => {
        const aName = a.name.toLowerCase();
        const bName = b.name.toLowerCase();
        const aExact = aName === query ? 0 : 1;
        const bExact = bName === query ? 0 : 1;
        if (aExact !== bExact) return aExact - bExact;
        const aStart = aName.startsWith(query) ? 0 : 1;
        const bStart = bName.startsWith(query) ? 0 : 1;
        if (aStart !== bStart) return aStart - bStart;
        return (b.paperCount ?? 0) - (a.paperCount ?? 0);
      })
      .slice(0, l);

    const indices = new Set();
    for (const f of matched) {
      for (const idx of indicesMap[f.facultyId] ?? []) indices.add(idx);
    }

    return {
      query,
      matches: matched.map((f) => ({
        facultyId: f.facultyId,
        name: f.name,
        department: f.department,
        paperCount: f.paperCount ?? 0,
        atlasCount: (indicesMap[f.facultyId] ?? []).length,
      })),
      matchCount: indices.size,
      indices: [...indices],
    };
  });
}

/** Paper atlas indices for one or more departments (exact names). */
export async function getDepartmentAtlasIndices({ departments } = {}) {
  const version = await activeVersionOrThrow();
  const deptIndex = await repo.getIndexDoc(version, "department-atlas-indices");
  if (!deptIndex) {
    throw new NotFoundError("Department atlas index not available. Run the KG pipeline first.");
  }
  const rawNames = (Array.isArray(departments) ? departments : [])
    .map((name) => String(name).trim())
    .filter(Boolean);
  if (!rawNames.length) {
    return { data: { departments: [], matchCount: 0, indices: [] }, cached: false };
  }

  const key = kgCacheKey(version, "department-atlas-indices", rawNames.join("|"));
  return cachedData(key, async () => {
    const indices = new Set();
    const resolved = [];
    for (const name of rawNames) {
      const entry = deptIndex[name];
      if (!entry) continue;
      resolved.push(name);
      for (const idx of entry.indices) indices.add(idx);
    }
    return { departments: resolved, matchCount: indices.size, indices: [...indices] };
  });
}

/** Paper atlas indices published on or after a calendar year. */
export async function getAtlasYearIndices({ sinceYear } = {}) {
  const version = await activeVersionOrThrow();
  const year = Number.parseInt(String(sinceYear ?? ""), 10);
  const currentYear = new Date().getUTCFullYear();
  if (!Number.isInteger(year) || year < 1900 || year > currentYear + 1) {
    return {
      data: { sinceYear: 0, matchCount: 0, indices: [] },
      cached: false,
    };
  }

  const key = kgCacheKey(version, "atlas-year-indices", year);
  return cachedData(key, async () => {
    const rows = await repo.getPointIndicesSinceYear(version, year);
    return {
      sinceYear: year,
      matchCount: rows.length,
      indices: rows.map((row) => row.i),
    };
  });
}

function mapSuggestTerm(row) {
  return {
    kind: row.type,
    key: row.key,
    label: row.term,
    paperCount: row.paperCount ?? 0,
    facultyCount: row.facultyCount ?? 0,
    deptCount: row.deptCount ?? 0,
  };
}

async function browseTopFaculty(version, limit, indicesMap) {
  const searchIndex = await repo.getIndexDoc(version, "faculty-search-index");
  if (!searchIndex) return [];
  return searchIndex.slice(0, limit).map((f) => ({
    facultyId: f.facultyId,
    name: f.name,
    department: f.department,
    paperCount: f.paperCount ?? 0,
    atlasCount: (indicesMap?.[f.facultyId] ?? []).length,
  }));
}

async function browseTopDepartments(version, limit) {
  const deptIndex = await repo.getIndexDoc(version, "department-atlas-indices");
  if (!deptIndex) return [];
  return Object.entries(deptIndex)
    .sort((a, b) => (b[1].indices?.length ?? 0) - (a[1].indices?.length ?? 0))
    .slice(0, limit)
    .map(([department, entry]) => ({
      department,
      facultyCount: entry.facultyCount ?? 0,
      paperCount: entry.indices?.length ?? 0,
    }));
}

/**
 * Blended atlas search suggestions for the knowledge-graph UI: themes, topics,
 * faculty, and departments. Read-only — reuses explore terms + existing indices.
 *
 * For free-text topics (e.g. "carbon") that do not appear in theme/faculty names,
 * also mines matching papers and surfaces the themes / topics / departments
 * that those papers belong to — so the dropdown stays useful for research topics.
 */
// Safety cap on how many title/abstract paper matches we resolve to atlas dots.
// This is not a "top N" display limit — the atlas overlay highlights all of
// them; the dropdown itself only renders a handful.
const PAPER_SUGGEST_CAP = 500;

/**
 * Papers whose title or abstract match the query (Scopus text index), narrowed
 * to those actually plotted on the atlas. Ordered by text relevance (title
 * weighted far above abstract by the Scopus text index weights).
 */
async function findAtlasPapersByTitleAbstract(version, query, cap = PAPER_SUGGEST_CAP) {
  const q = String(query ?? "").trim();
  if (!q) return [];
  const metaRows = await ResearchMetaDataScopus.find(
    { $text: { $search: q } },
    { _id: 1, title: 1, score: { $meta: "textScore" } },
  )
    .sort({ score: { $meta: "textScore" } })
    .limit(cap)
    .lean()
    .catch(() => []);
  if (!metaRows.length) return [];

  const idOrder = metaRows.map((r) => String(r._id));
  const titleById = new Map(metaRows.map((r) => [String(r._id), r.title]));
  const points = await repo.findAtlasPointsByPaperIds(version, idOrder);
  const pointById = new Map(points.map((p) => [String(p.id), p]));

  const papers = [];
  for (const id of idOrder) {
    const p = pointById.get(id);
    if (!p) continue; // Not on the atlas — skip.
    papers.push({
      id,
      i: p.i,
      title: p.title || titleById.get(id) || "",
      theme: p.theme || "",
      department: p.department || "",
    });
  }
  return papers;
}

// Common words we never want as a keyword suggestion head/tail.
const KEYWORD_STOPWORDS = new Set([
  "the", "a", "an", "of", "and", "or", "for", "to", "in", "on", "at", "with",
  "by", "using", "used", "use", "based", "via", "from", "into", "over", "under",
  "new", "novel", "study", "studies", "analysis", "approach", "approaches",
  "effect", "effects", "role", "review", "toward", "towards", "between", "their",
  "its", "this", "that", "these", "those", "as", "is", "are", "be", "we", "our",
]);

/**
 * Build short keyword/phrase completions (e.g. "carbon" → "carbon dioxide",
 * "carbon fiber") from matching paper titles. Phrases start at the token that
 * prefix-matches the query's last token, extend up to 3 words, and are ranked
 * by how many titles contain them.
 */
function extractKeywordSuggestions(query, papers, limit) {
  const q = String(query ?? "").trim().toLowerCase();
  const qTokens = q.split(/[^a-z0-9]+/).filter(Boolean);
  if (!qTokens.length || !papers?.length) return [];
  const head = qTokens[qTokens.length - 1];

  const counts = new Map();
  const bump = (phrase) => counts.set(phrase, (counts.get(phrase) ?? 0) + 1);

  for (const p of papers) {
    const words = String(p.title ?? "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
    for (let i = 0; i < words.length; i++) {
      if (!words[i].startsWith(head) || words[i].length < 2) continue;
      let phrase = words[i];
      const seen = new Set([phrase]);
      bump(phrase);
      for (let len = 1; len <= 2; len++) {
        const next = words[i + len];
        if (!next || KEYWORD_STOPWORDS.has(next) || next.length < 2) break;
        phrase = `${phrase} ${next}`;
        if (seen.has(phrase)) break;
        seen.add(phrase);
        bump(phrase);
      }
    }
  }

  return [...counts.entries()]
    .filter(([term]) => !KEYWORD_STOPWORDS.has(term))
    .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term, count]) => ({ term, paperCount: count }));
}

export async function searchAtlasSuggest({ q, limit } = {}) {
  const version = await activeVersionOrThrow();
  const query = String(q ?? "").trim();
  const perGroup = Math.min(Number(limit) || 8, 20);
  const key = kgCacheKey(version, "atlas-suggest-v5", query.toLowerCase(), perGroup);

  return cachedData(key, async () => {
    if (!query) {
      const [themeRows, topicRows, indicesMap] = await Promise.all([
        repo.findExploreTerms(version, { type: "theme" }, perGroup),
        repo.findExploreTerms(version, { type: "topic" }, perGroup),
        repo.getIndexDoc(version, "faculty-atlas-indices"),
      ]);
      const [faculty, departments] = await Promise.all([
        browseTopFaculty(version, perGroup, indicesMap),
        browseTopDepartments(version, Math.ceil(perGroup / 2)),
      ]);
      return {
        query: "",
        keywords: [],
        themes: themeRows.map(mapSuggestTerm),
        topics: topicRows.map(mapSuggestTerm),
        faculty,
        departments,
        papers: [],
        paperMatchCount: 0,
      };
    }

    const termFilter = { term: { $regex: escapeRegex(query), $options: "i" } };
    const [termRows, facultyResult, deptResult, paperHits, titlePapers] = await Promise.all([
      repo.findExploreTerms(version, termFilter, perGroup * 4),
      searchAtlasFaculty({ q: query, limit: perGroup }),
      searchAtlasDepartment({ q: query, limit: Math.ceil(perGroup / 2) }),
      // Sample papers matching the topic so we can rank related taxonomy.
      repo.searchAtlasPoints(version, query, Math.min(1200, perGroup * 150)).catch(() => []),
      // Direct paper matches from title/abstract — surfaced as their own group.
      findAtlasPapersByTitleAbstract(version, query),
    ]);

    const themes = [];
    const topics = [];
    const seenTheme = new Set();
    const seenTopic = new Set();
    for (const row of termRows) {
      if (row.type === "theme" && themes.length < perGroup) {
        themes.push(mapSuggestTerm(row));
        seenTheme.add(String(row.term || "").toLowerCase());
      } else if (row.type === "topic" && topics.length < perGroup) {
        topics.push(mapSuggestTerm(row));
        seenTopic.add(String(row.term || "").toLowerCase());
      }
    }

    const faculty = (facultyResult.data?.matches ?? []).map((f) => ({
      facultyId: f.facultyId,
      name: f.name,
      department: f.department,
      paperCount: f.paperCount ?? 0,
      atlasCount: f.atlasCount ?? 0,
    }));

    const departments = (deptResult.data?.matches ?? []).map((d) => ({
      department: d.department,
      facultyCount: d.facultyCount ?? 0,
      paperCount: d.atlasCount ?? 0,
    }));
    const seenDept = new Set(departments.map((d) => d.department.toLowerCase()));

    const paperMatchCount = paperHits.length;
    if (paperHits.length) {
      const indices = paperHits.map((r) => r.i);
      const points = await repo.getPointsByIndices(version, indices.slice(0, 800));
      const themeCounts = new Map();
      const topicCounts = new Map();
      for (const p of points) {
        const theme = String(p.theme || "").trim();
        const topic = String(p.topic || "").trim();
        if (theme) themeCounts.set(theme, (themeCounts.get(theme) ?? 0) + 1);
        if (topic) topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);
      }

      const relatedThemes = [...themeCounts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      for (const [label, count] of relatedThemes) {
        if (themes.length >= perGroup) break;
        const keyL = label.toLowerCase();
        if (seenTheme.has(keyL)) continue;
        seenTheme.add(keyL);
        themes.push({
          kind: "theme",
          key: `related-theme:${label}`,
          label,
          paperCount: count,
          facultyCount: 0,
          deptCount: 0,
        });
      }

      const relatedTopics = [...topicCounts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      for (const [label, count] of relatedTopics) {
        if (topics.length >= perGroup) break;
        const keyL = label.toLowerCase();
        if (seenTopic.has(keyL)) continue;
        // Skip topics that don't relate to the query at all when we already have name hits;
        // for keyword queries, any frequent topic in matching papers is useful context.
        seenTopic.add(keyL);
        topics.push({
          kind: "topic",
          key: `related-topic:${label}`,
          label,
          paperCount: count,
          facultyCount: 0,
          deptCount: 0,
        });
      }

      // NOTE: We intentionally do NOT inject paper-derived "related" departments.
      // Departments are prioritised at the top of the dropdown, so only genuine
      // name matches belong in this list; otherwise a topic query like "carbon"
      // (no department named carbon) would surface loosely-related departments
      // and bury the keyword suggestions. When there's no name match, the keyword
      // group carries the "related to your search" role.
    }

    const keywords = extractKeywordSuggestions(query, titlePapers, perGroup);

    return {
      query,
      keywords,
      themes,
      topics,
      faculty,
      departments,
      papers: titlePapers,
      paperMatchCount,
    };
  });
}

/** Search departments by name; returns matches + union of atlas paper indices. */
export async function searchAtlasDepartment({ q, limit } = {}) {
  const version = await activeVersionOrThrow();
  const deptIndex = await repo.getIndexDoc(version, "department-atlas-indices");
  if (!deptIndex) {
    throw new NotFoundError("Department atlas index not available. Run the KG pipeline first.");
  }
  const query = String(q ?? "").trim().toLowerCase();
  const l = Math.min(Number(limit) || 12, 50);
  if (!query) {
    return { data: { query: "", matches: [], matchCount: 0, indices: [] }, cached: false };
  }

  const key = kgCacheKey(version, "department-atlas-search", query, l);
  return cachedData(key, async () => {
    const tokens = query.split(/\s+/).filter((token) => token.length >= 2);
    const matched = Object.entries(deptIndex)
      .filter(([name]) => nameMatches(name, query, tokens))
      .sort((a, b) => {
        const [aName, aEntry] = a;
        const [bName, bEntry] = b;
        const aHay = aName.toLowerCase();
        const bHay = bName.toLowerCase();
        const aExact = aHay === query ? 0 : 1;
        const bExact = bHay === query ? 0 : 1;
        if (aExact !== bExact) return aExact - bExact;
        const aStart = aHay.startsWith(query) ? 0 : 1;
        const bStart = bHay.startsWith(query) ? 0 : 1;
        if (aStart !== bStart) return aStart - bStart;
        return bEntry.indices.length - aEntry.indices.length;
      })
      .slice(0, l);

    // Exact department name → only that department's papers. Token matching
    // otherwise pulls in siblings (e.g. "Chemical Engineering" also hits
    // "Biochemical Engineering & Biotechnology" via includes("chemical")).
    const exact = matched.filter(([name]) => name.toLowerCase() === query);
    const useRows = exact.length ? exact : matched;

    const indices = new Set();
    for (const [, entry] of useRows) {
      for (const idx of entry.indices) indices.add(idx);
    }

    return {
      query,
      matches: matched.map(([department, entry]) => ({
        department,
        facultyCount: entry.facultyCount,
        atlasCount: entry.indices.length,
      })),
      matchCount: indices.size,
      indices: [...indices],
    };
  });
}

/** Theme cluster breakdown: departments + papers matching search within a theme. */
function formatClusterPaper(paper) {
  return {
    id: paper.id,
    i: paper.i,
    title: paper.title,
    domain: paper.domain ?? "",
    topic: paper.topic ?? "",
    citations: paper.citations ?? 0,
  };
}

/**
 * Nest faculty under a department using the faculty atlas indices.
 * Only professors belonging to that department whose papers appear in
 * `deptIndices` are included — one browse level below the department.
 */
function nestFacultyForDepartment(department, deptIndices, paperByI, searchIndex, indicesMap, paperLimit) {
  const deptNorm = String(department || "").trim().toLowerCase();
  if (!deptNorm || deptNorm === "unassigned" || !searchIndex?.length || !indicesMap) {
    return [];
  }
  const faculty = [];
  for (const f of searchIndex) {
    if (String(f.department || "").trim().toLowerCase() !== deptNorm) continue;
    const facIndices = indicesMap[f.facultyId] ?? [];
    const overlap = [];
    for (const idx of facIndices) {
      if (deptIndices.has(idx)) overlap.push(idx);
    }
    if (!overlap.length) continue;
    faculty.push({
      facultyId: f.facultyId,
      name: f.name,
      paperCount: overlap.length,
      papers: overlap
        .slice(0, paperLimit)
        .map((i) => paperByI.get(i))
        .filter(Boolean)
        .map(formatClusterPaper),
    });
  }
  return faculty.sort(
    (a, b) => b.paperCount - a.paperCount || a.name.localeCompare(b.name),
  );
}

export async function getAtlasClusterBreakdown({ theme, q, paperLimit } = {}) {
  const version = await activeVersionOrThrow();
  const themeVal = String(theme ?? "").trim();
  const query = String(q ?? "").trim();
  const l = Math.min(Number(paperLimit) || 200, 500);

  if (!themeVal || !query) {
    return { data: { theme: themeVal, query, totalPapers: 0, departments: [] }, cached: false };
  }

  // v2: departments → faculty → papers
  const key = kgCacheKey(version, "cluster-breakdown-v2", themeVal, query, l);
  return cachedData(key, async () => {
    const [deptIndex, searchIndex, indicesMap] = await Promise.all([
      repo.getIndexDoc(version, "department-atlas-indices"),
      repo.getIndexDoc(version, "faculty-search-index"),
      repo.getIndexDoc(version, "faculty-atlas-indices"),
    ]);
    /** @type {Map<number, string[]>} */
    const idxToDepts = new Map();
    if (deptIndex) {
      for (const [deptName, entry] of Object.entries(deptIndex)) {
        for (const idx of entry.indices) {
          const list = idxToDepts.get(idx) ?? [];
          list.push(deptName);
          idxToDepts.set(idx, list);
        }
      }
    }

    // Fetch enough matches to fill per-department buckets. Cap generous but bounded.
    const points = await repo.findThemePoints(version, themeVal, query, Math.max(l * 8, 2000));
    const paperByI = new Map(points.map((p) => [p.i, p]));

    /** @type {Map<string, { paperCount: number; papers: object[]; indices: Set<number> }>} */
    const byDept = new Map();
    let totalPapers = 0;

    for (const paper of points) {
      totalPapers += 1;
      const deptNames = String(paper.department ?? "").trim()
        ? [String(paper.department).trim()]
        : (idxToDepts.get(paper.i)?.length ? idxToDepts.get(paper.i) : ["Unassigned"]);

      for (const dept of deptNames) {
        let entry = byDept.get(dept);
        if (!entry) {
          entry = { paperCount: 0, papers: [], indices: new Set() };
          byDept.set(dept, entry);
        }
        entry.paperCount += 1;
        entry.indices.add(paper.i);
        if (entry.papers.length < l) {
          entry.papers.push(formatClusterPaper(paper));
        }
      }
    }

    const departments = [...byDept.entries()]
      .map(([department, entry]) => ({
        department,
        paperCount: entry.paperCount,
        faculty: nestFacultyForDepartment(
          department,
          entry.indices,
          paperByI,
          searchIndex,
          indicesMap,
          l,
        ),
        // Flat paper list kept as fallback when a department has no faculty matches.
        papers: entry.papers,
      }))
      .sort((a, b) => b.paperCount - a.paperCount || a.department.localeCompare(b.department));

    return { theme: themeVal, query, totalPapers, departments };
  });
}
