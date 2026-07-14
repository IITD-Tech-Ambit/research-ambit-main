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
    data: { points: rows.map((r) => ({ i: r.i, x: r.x, y: r.y, z: r.z })) },
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
  const key = kgCacheKey(version, "atlas-search", query.toLowerCase(), l);
  return cachedData(key, async () => {
    const rows = await repo.searchAtlasPoints(version, query, l);
    return { query, matchCount: rows.length, indices: rows.map((r) => r.i) };
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

    const indices = new Set();
    for (const [, entry] of matched) {
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
export async function getAtlasClusterBreakdown({ theme, q, paperLimit } = {}) {
  const version = await activeVersionOrThrow();
  const themeVal = String(theme ?? "").trim();
  const query = String(q ?? "").trim();
  const l = Math.min(Number(paperLimit) || 200, 500);

  if (!themeVal || !query) {
    return { data: { theme: themeVal, query, totalPapers: 0, departments: [] }, cached: false };
  }

  const key = kgCacheKey(version, "cluster-breakdown", themeVal, query, l);
  return cachedData(key, async () => {
    const deptIndex = await repo.getIndexDoc(version, "department-atlas-indices");
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

    /** @type {Map<string, { paperCount: number; papers: object[] }>} */
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
          entry = { paperCount: 0, papers: [] };
          byDept.set(dept, entry);
        }
        entry.paperCount += 1;
        if (entry.papers.length < l) {
          entry.papers.push({
            id: paper.id,
            i: paper.i,
            title: paper.title,
            domain: paper.domain ?? "",
            topic: paper.topic ?? "",
            citations: paper.citations ?? 0,
          });
        }
      }
    }

    const departments = [...byDept.entries()]
      .map(([department, entry]) => ({
        department,
        paperCount: entry.paperCount,
        papers: entry.papers,
      }))
      .sort((a, b) => b.paperCount - a.paperCount || a.department.localeCompare(b.department));

    return { theme: themeVal, query, totalPapers, departments };
  });
}
