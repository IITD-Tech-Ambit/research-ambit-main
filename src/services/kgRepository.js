/**
 * Mongo-backed data-access layer for all Knowledge-Graph reads. Resolves the
 * active build version once (short-lived cache), serves small JSON structures
 * from Redis, and keeps hot binary tiles in a bounded in-process LRU (binary is
 * awkward to round-trip through the string Redis client, and tiles are the
 * hottest, most cache-friendly reads). Everything is keyed by the immutable
 * build `version`, so cached entries can never go stale under a rebuild.
 */
import {
  AtlasTile,
  AtlasMeta,
  AtlasPoint,
  KgFacultyGraph,
  KgExplore,
  KgIndex,
  ACTIVE_POINTER_ID,
} from "../models/knowledgeGraph.js";
import { kgCacheGet, kgCacheKey, kgCacheSet } from "../lib/kgCache.js";

const ACTIVE_TTL_MS = Number(process.env.KG_ACTIVE_TTL_MS) || 30_000;
const TILE_LRU_MAX = Number(process.env.KG_TILE_LRU_MAX) || 512;

let activeCache = { version: null, expiresAt: 0 };
/** @type {Map<string, Buffer>} */
const tileLru = new Map();

function lruTouch(key) {
  const value = tileLru.get(key);
  if (value === undefined) return undefined;
  tileLru.delete(key);
  tileLru.set(key, value);
  return value;
}

function lruStore(key, value) {
  if (tileLru.has(key)) tileLru.delete(key);
  tileLru.set(key, value);
  while (tileLru.size > TILE_LRU_MAX) {
    tileLru.delete(tileLru.keys().next().value);
  }
}

function toBuffer(payload) {
  if (!payload) return null;
  if (Buffer.isBuffer(payload)) return payload;
  if (payload.buffer) return Buffer.from(payload.buffer); // bson Binary
  return Buffer.from(payload);
}

/** Resolve the live build version (atlas_meta pointer doc). Cached ~30s. */
export async function getActiveVersion() {
  if (activeCache.version && Date.now() < activeCache.expiresAt) {
    return activeCache.version;
  }
  const ptr = await AtlasMeta.findOne({ _id: ACTIVE_POINTER_ID, kind: "pointer" }).lean();
  activeCache = { version: ptr?.version || null, expiresAt: Date.now() + ACTIVE_TTL_MS };
  return activeCache.version;
}

export function clearActiveVersionCache() {
  activeCache = { version: null, expiresAt: 0 };
}

/** Per-version octree header tree + taxonomy dict (small; Redis-cached). */
export async function getVersionMeta(version) {
  if (!version) return null;
  const key = kgCacheKey(version, "atlas-meta");
  const cached = await kgCacheGet(key);
  if (cached) return JSON.parse(cached);

  const doc = await AtlasMeta.findOne({ _id: version, kind: "version" }).lean();
  if (!doc) return null;
  const meta = {
    version,
    pointCount: doc.pointCount ?? 0,
    tree: doc.tree ?? null,
    dict: doc.dict ?? null,
  };
  await kgCacheSet(key, JSON.stringify(meta));
  return meta;
}

/** One octree node's binary payload. Returns { payload: Buffer|null, cached }. */
export async function getTile(version, nodeKey) {
  const key = `${version}:${nodeKey}`;
  const hit = lruTouch(key);
  if (hit) return { payload: hit, cached: true };

  const doc = await AtlasTile.findOne({ version, nodeKey }).lean();
  const buf = toBuffer(doc?.payload);
  if (!buf) return { payload: null, cached: false };
  lruStore(key, buf);
  return { payload: buf, cached: false };
}

/** Full per-faculty knowledge graph object. */
export async function getFacultyGraphDoc(version, facultyId) {
  const doc = await KgFacultyGraph.findOne({ version, facultyId }).lean();
  return doc?.graph ?? null;
}

/** A derived index structure by name (Redis-cached). */
export async function getIndexDoc(version, name) {
  const key = kgCacheKey(version, "index", name);
  const cached = await kgCacheGet(key);
  if (cached) return JSON.parse(cached);

  const doc = await KgIndex.findOne({ version, name }).lean();
  if (!doc) return null;
  await kgCacheSet(key, JSON.stringify(doc.payload));
  return doc.payload;
}

/** Topic-explorer term rows matching a Mongo filter. */
export async function findExploreTerms(version, filter, limit) {
  const fetchLimit = Math.min(Math.max(limit * 5, limit), 200);
  const rows = await KgExplore.find({ version, kind: "term", ...filter })
    .limit(fetchLimit)
    .lean();
  return rows
    .map((r) => r.payload)
    .sort((a, b) => (b.paperCount ?? 0) - (a.paperCount ?? 0))
    .slice(0, limit);
}

export async function findExploreDetail(version, keyParam) {
  const doc = await KgExplore.findOne({ version, kind: "detail", key: keyParam }).lean();
  return doc?.payload ?? null;
}

export async function hasExploreTerms(version) {
  if (!version) return false;
  const doc = await KgExplore.findOne({ version, kind: "term" }).select("_id").lean();
  return !!doc;
}

/**
 * Atlas paper search. Requires every query token to appear in at least one
 * searchable field (logical AND). Mongo `$text` alone uses OR for multi-word
 * queries, which made "heat transfer" return more hits than "heat".
 */
export async function searchAtlasPoints(version, query, limit) {
  if (!version || !query) return [];
  const projection = { _id: 0, i: 1, x: 1, y: 1, z: 1 };
  const tokens = tokenizeQuery(query);
  if (!tokens.length) return [];

  const andClauses = tokenAndClauses(tokens);

  // Prefer text-index shortlist for single-token queries (fast path), then fall
  // back to the AND regex scan when text yields nothing.
  if (tokens.length === 1) {
    let rows = await AtlasPoint.find(
      { version, $text: { $search: tokens[0] } },
      { ...projection, score: { $meta: "textScore" } },
    )
      .sort({ score: { $meta: "textScore" } })
      .limit(limit)
      .lean();
    if (rows.length) return rows;
  }

  return AtlasPoint.find({ version, $and: andClauses }, projection)
    .limit(limit)
    .lean();
}

const IN_CHUNK = 4000;

function tokenizeQuery(query) {
  return String(query)
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}-]+/gu, ""))
    .filter((t) => t.length >= 2);
}

function tokenAndClauses(tokens) {
  return tokens.map((token) => {
    const rx = new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    return {
      $or: [
        { title: rx },
        { theme: rx },
        { domain: rx },
        { subdomain: rx },
        { topic: rx },
      ],
    };
  });
}

/**
 * Same AND-token paper search, restricted to a set of atlas indices.
 * Chunks `$in` to stay under Mongo BSON limits.
 */
export async function searchAtlasPointsWithin(version, query, withinIndices, limit) {
  if (!version || !query || !withinIndices?.length || limit <= 0) return [];
  const tokens = tokenizeQuery(query);
  if (!tokens.length) return [];

  const projection = { _id: 0, i: 1, x: 1, y: 1, z: 1 };
  const andClauses = tokenAndClauses(tokens);
  const out = [];
  const seen = new Set();

  for (let off = 0; off < withinIndices.length && out.length < limit; off += IN_CHUNK) {
    const chunk = withinIndices.slice(off, off + IN_CHUNK);
    const rows = await AtlasPoint.find(
      { version, i: { $in: chunk }, $and: andClauses },
      projection,
    )
      .limit(limit - out.length)
      .lean();
    for (const row of rows) {
      if (seen.has(row.i)) continue;
      seen.add(row.i);
      out.push(row);
      if (out.length >= limit) break;
    }
  }
  return out;
}

/**
 * Papers whose department matches the query, restricted to `withinIndices`.
 */
export async function findPointsByDepartmentWithin(version, deptQuery, withinIndices, limit) {
  if (!version || !deptQuery || !withinIndices?.length || limit <= 0) return [];
  const q = String(deptQuery).trim();
  if (!q) return [];
  const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const projection = { _id: 0, i: 1, x: 1, y: 1, z: 1 };
  const out = [];
  const seen = new Set();

  for (let off = 0; off < withinIndices.length && out.length < limit; off += IN_CHUNK) {
    const chunk = withinIndices.slice(off, off + IN_CHUNK);
    const rows = await AtlasPoint.find(
      { version, i: { $in: chunk }, department: rx },
      projection,
    )
      .limit(limit - out.length)
      .lean();
    for (const row of rows) {
      if (seen.has(row.i)) continue;
      seen.add(row.i);
      out.push(row);
      if (out.length >= limit) break;
    }
  }
  return out;
}

/** Exact coords + taxonomy for a set of atlas indices (highlight overlay). */
export async function getPointsByIndices(version, indices) {
  if (!version || !indices?.length) return [];
  return AtlasPoint.find(
    { version, i: { $in: indices } },
    { _id: 0, i: 1, id: 1, title: 1, theme: 1, department: 1, x: 1, y: 1, z: 1 },
  ).lean();
}

/** Papers in a theme matching a query — powers the cluster breakdown. */
export async function findThemePoints(version, theme, query, limit) {
  const filter = { version, theme };
  if (query) {
    const rx = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ title: rx }, { theme: rx }, { domain: rx }, { subdomain: rx }, { topic: rx }];
  }
  return AtlasPoint.find(filter, {
    _id: 0, i: 1, id: 1, title: 1, domain: 1, topic: 1, department: 1, citations: 1,
  })
    .limit(limit)
    .lean();
}

export async function countPoints(version) {
  if (!version) return 0;
  return AtlasPoint.countDocuments({ version });
}
