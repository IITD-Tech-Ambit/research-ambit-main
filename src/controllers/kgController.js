import { readFile } from "node:fs/promises";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { asyncErrorHandler } from "../middleware/errorHandler.js";
import { NotFoundError } from "../lib/customErrors.js";
import { successResponse } from "../lib/responseUtils.js";
import ResearchMetaDataScopus from "../models/research_scopus.js";
import Faculty from "../models/faculty.js";

const kerberosFromEmail = (email) => {
  const e = String(email || "").trim().toLowerCase();
  if (!e.includes("@")) return "";
  return e.split("@")[0];
};

const escapeRegex = (input = "") => input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const KG_DATA_DIR = process.env.KG_DATA_DIR
  ? path.resolve(process.env.KG_DATA_DIR)
  : path.join(PROJECT_ROOT, "data", "knowledge-graph");
const GRAPHS_DIR = path.join(KG_DATA_DIR, "graphs");
const EXPLORE_FILE = path.join(KG_DATA_DIR, "explore_index.json");
const ATLAS_FILE = path.join(KG_DATA_DIR, "atlas_papers.json");
const FACULTY_INDICES_FILE = path.join(KG_DATA_DIR, "atlas_faculty_indices.json");

let exploreIndex = { terms: [], detail: {} };
let atlasMeta = { ready: false, count: 0 };
/** @type {Record<string, number[]> | null} */
let atlasFacultyIndices = null;

function loadExploreIndex() {
  if (!existsSync(EXPLORE_FILE)) {
    console.warn(
      "[kg] explore_index.json not found — Topic Explorer disabled until you run knowledge-graph/pipeline/build_kg.py",
    );
    return;
  }
  try {
    exploreIndex = JSON.parse(readFileSync(EXPLORE_FILE, "utf-8"));
    console.log(`[kg] loaded ${exploreIndex.terms?.length ?? 0} explore terms`);
  } catch (err) {
    console.error(`[kg] failed to parse explore_index.json: ${err.message}`);
  }
}

loadExploreIndex();

function loadAtlasMeta() {
  if (!existsSync(ATLAS_FILE)) {
    console.warn(
      "[kg] atlas_papers.json not found — Research Atlas disabled until you run knowledge-graph/pipeline/build_atlas.py",
    );
    return;
  }
  try {
    const raw = readFileSync(ATLAS_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    atlasMeta = { ready: true, count: parsed.count ?? parsed.papers?.length ?? 0 };
    console.log(`[kg] atlas ready — ${atlasMeta.count.toLocaleString()} papers`);
  } catch (err) {
    console.error(`[kg] failed to parse atlas_papers.json: ${err.message}`);
  }
}

loadAtlasMeta();

function loadAtlasFacultyIndices() {
  if (!existsSync(FACULTY_INDICES_FILE)) return;
  try {
    const parsed = JSON.parse(readFileSync(FACULTY_INDICES_FILE, "utf-8"));
    atlasFacultyIndices = parsed.byFacultyId ?? {};
    console.log(
      `[kg] faculty atlas index — ${Object.keys(atlasFacultyIndices).length.toLocaleString()} faculty`,
    );
  } catch (err) {
    console.error(`[kg] failed to parse atlas_faculty_indices.json: ${err.message}`);
  }
}

function buildAtlasFacultyIndicesFromGraphs() {
  if (!existsSync(ATLAS_FILE) || !existsSync(GRAPHS_DIR)) return null;

  console.log("[kg] building faculty atlas index from graphs (one-time) …");
  const atlas = JSON.parse(readFileSync(ATLAS_FILE, "utf-8"));
  /** @type {Record<string, number>} */
  const paperIdToIndex = {};
  for (const paper of atlas.papers ?? []) {
    paperIdToIndex[paper.id] = paper.i;
  }

  /** @type {Record<string, number[]>} */
  const byFacultyId = {};
  for (const file of readdirSync(GRAPHS_DIR)) {
    if (!file.endsWith(".json") || file === "index.json") continue;
    const facultyId = file.replace(/\.json$/, "");
    const graph = JSON.parse(readFileSync(path.join(GRAPHS_DIR, file), "utf-8"));
    const indices = new Set();
    for (const node of graph.nodes ?? []) {
      if (node.type !== "paper") continue;
      const pid = String(node.id).replace(/^p:/, "");
      const idx = paperIdToIndex[pid];
      if (idx !== undefined) indices.add(idx);
    }
    if (indices.size) {
      byFacultyId[facultyId] = [...indices].sort((a, b) => a - b);
    }
  }

  atlasFacultyIndices = byFacultyId;
  console.log(
    `[kg] built faculty atlas index — ${Object.keys(byFacultyId).length.toLocaleString()} faculty`,
  );
  return atlasFacultyIndices;
}

function ensureAtlasFacultyIndices() {
  if (atlasFacultyIndices) return atlasFacultyIndices;
  loadAtlasFacultyIndices();
  if (atlasFacultyIndices) return atlasFacultyIndices;
  return buildAtlasFacultyIndicesFromGraphs();
}

loadAtlasFacultyIndices();

let facultySearchIndex = [];

function loadFacultySearchIndex() {
  const indexPath = path.join(GRAPHS_DIR, "index.json");
  if (!existsSync(indexPath)) return;
  try {
    facultySearchIndex = JSON.parse(readFileSync(indexPath, "utf-8"));
  } catch (err) {
    console.error(`[kg] failed to load faculty search index: ${err.message}`);
  }
}

loadFacultySearchIndex();

async function readJsonFile(filePath) {
  const raw = await readFile(filePath, "utf-8");
  return JSON.parse(raw);
}

const kg = {};

kg.health = asyncErrorHandler(async (_req, res) => {
  return successResponse(res, {
    graphsReady: existsSync(path.join(GRAPHS_DIR, "index.json")),
    exploreReady: (exploreIndex.terms?.length ?? 0) > 0,
    atlasReady: atlasMeta.ready,
    atlasCount: atlasMeta.count,
    dataDir: KG_DATA_DIR,
  });
});

kg.getFacultyIndex = asyncErrorHandler(async (_req, res) => {
  const indexPath = path.join(GRAPHS_DIR, "index.json");
  if (!existsSync(indexPath)) {
    throw new NotFoundError(
      "Faculty index not found. Run knowledge-graph/pipeline/build_kg.py first.",
    );
  }
  const data = await readJsonFile(indexPath);
  return successResponse(res, data);
});

kg.getFacultyGraph = asyncErrorHandler(async (req, res) => {
  const id = String(req.params.id).replace(/[^a-zA-Z0-9_-]/g, "");
  const graphPath = path.join(GRAPHS_DIR, `${id}.json`);
  if (!existsSync(graphPath)) {
    throw new NotFoundError(`No knowledge graph for faculty '${id}'.`);
  }
  const data = await readJsonFile(graphPath);
  return successResponse(res, data);
});

kg.getExploreTerms = asyncErrorHandler(async (req, res) => {
  const all = exploreIndex.terms ?? [];
  const q = String(req.query.q ?? "").trim().toLowerCase();
  const type = String(req.query.type ?? "").trim();
  const limit = Math.min(Number(req.query.limit) || 40, 200);

  let results;
  if (!q) {
    results = all.filter((t) => t.type === "theme" || t.type === "subdomain");
  } else {
    results = all.filter((t) => t.term.toLowerCase().includes(q));
  }
  if (type) results = results.filter((t) => t.type === type);

  return successResponse(res, results.slice(0, limit));
});

kg.getExploreDetail = asyncErrorHandler(async (req, res) => {
  const key = String(req.query.key ?? "");
  const detail = exploreIndex.detail?.[key];
  if (!detail) {
    throw new NotFoundError(`No explore detail for key '${key}'.`);
  }
  return successResponse(res, detail);
});

/** Paper metadata + full detail for Research Atlas click panel. */
kg.getPaperMeta = asyncErrorHandler(async (req, res) => {
  const rawId = String(req.params.id).replace(/[^a-fA-F0-9]/g, "");
  if (!rawId) {
    throw new NotFoundError("Invalid paper id.");
  }
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

  return successResponse(res, {
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
  });
});

/** Full 3D atlas payload (all paper positions + metadata). */
kg.getAtlas = asyncErrorHandler(async (_req, res) => {
  if (!existsSync(ATLAS_FILE)) {
    throw new NotFoundError(
      "Atlas not found. Run knowledge-graph/pipeline/build_atlas.py first.",
    );
  }
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600");
  return res.sendFile(path.resolve(ATLAS_FILE));
});

/** Search atlas papers by title, theme, sub-domain, or topic. */
kg.searchAtlas = asyncErrorHandler(async (req, res) => {
  if (!existsSync(ATLAS_FILE)) {
    throw new NotFoundError(
      "Atlas not found. Run knowledge-graph/pipeline/build_atlas.py first.",
    );
  }
  const q = String(req.query.q ?? "").trim().toLowerCase();
  const limit = Math.min(Number(req.query.limit) || 5000, 70000);
  if (!q) {
    return successResponse(res, { query: "", matchCount: 0, indices: [] });
  }

  const raw = await readFile(ATLAS_FILE, "utf-8");
  const atlas = JSON.parse(raw);
  const tokens = q.split(/\s+/).filter((t) => t.length >= 2);
  const indices = [];

  for (const paper of atlas.papers ?? []) {
    const haystack = [
      paper.title,
      paper.theme,
      paper.subdomain,
      paper.topic,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const matches =
      tokens.length === 0
        ? haystack.includes(q)
        : tokens.every((t) => haystack.includes(t));
    if (matches) {
      indices.push(paper.i);
      if (indices.length >= limit) break;
    }
  }

  return successResponse(res, {
    query: q,
    matchCount: indices.length,
    indices,
  });
});

function facultyNameMatches(name, query, tokens) {
  const hay = String(name || "").toLowerCase();
  if (!hay) return false;
  if (hay.includes(query)) return true;
  if (tokens.length > 1) return tokens.every((t) => hay.includes(t));
  return false;
}

/** Paper atlas indices for one or more faculty (by id). */
kg.getFacultyAtlasIndices = asyncErrorHandler(async (req, res) => {
  const indicesMap = ensureAtlasFacultyIndices();
  if (!indicesMap) {
    throw new NotFoundError(
      "Faculty atlas index not available. Run knowledge-graph/pipeline/build_atlas.py first.",
    );
  }
  const rawIds = String(req.query.ids ?? "")
    .split(",")
    .map((id) => id.trim().replace(/[^a-zA-Z0-9_-]/g, ""))
    .filter(Boolean);
  if (!rawIds.length) {
    return successResponse(res, { facultyIds: [], matchCount: 0, indices: [] });
  }

  const indices = new Set();
  for (const id of rawIds) {
    for (const idx of indicesMap[id] ?? []) {
      indices.add(idx);
    }
  }

  return successResponse(res, {
    facultyIds: rawIds,
    matchCount: indices.size,
    indices: [...indices],
  });
});

/** Search faculty by name; returns matches + their atlas paper indices. */
kg.searchAtlasFaculty = asyncErrorHandler(async (req, res) => {
  const indicesMap = ensureAtlasFacultyIndices();
  if (!indicesMap) {
    throw new NotFoundError(
      "Faculty atlas index not available. Run knowledge-graph/pipeline/build_atlas.py first.",
    );
  }
  const q = String(req.query.q ?? "").trim().toLowerCase();
  const limit = Math.min(Number(req.query.limit) || 12, 50);
  if (!q) {
    return successResponse(res, { query: "", matches: [], matchCount: 0, indices: [] });
  }

  const tokens = q.split(/\s+/).filter((t) => t.length >= 2);
  const matched = facultySearchIndex
    .filter((f) => facultyNameMatches(f.name, q, tokens))
    .sort((a, b) => {
      const aName = a.name.toLowerCase();
      const bName = b.name.toLowerCase();
      const aExact = aName === q ? 0 : 1;
      const bExact = bName === q ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;
      const aStart = aName.startsWith(q) ? 0 : 1;
      const bStart = bName.startsWith(q) ? 0 : 1;
      if (aStart !== bStart) return aStart - bStart;
      return (b.paperCount ?? 0) - (a.paperCount ?? 0);
    })
    .slice(0, limit);

  const indices = new Set();
  for (const f of matched) {
    for (const idx of indicesMap[f.facultyId] ?? []) {
      indices.add(idx);
    }
  }

  return successResponse(res, {
    query: q,
    matches: matched.map((f) => ({
      facultyId: f.facultyId,
      name: f.name,
      department: f.department,
      paperCount: f.paperCount ?? 0,
      atlasCount: (indicesMap[f.facultyId] ?? []).length,
    })),
    matchCount: indices.size,
    indices: [...indices],
  });
});

/** @type {Record<string, { indices: number[]; facultyCount: number }> | null} */
let atlasDepartmentIndex = null;

function ensureAtlasDepartmentIndex() {
  if (atlasDepartmentIndex) return atlasDepartmentIndex;
  const facultyMap = ensureAtlasFacultyIndices();
  if (!facultyMap || !facultySearchIndex.length) return null;

  /** @type {Record<string, { indices: Set<number>; facultyCount: number }>} */
  const byDept = {};
  for (const fac of facultySearchIndex) {
    const dept = String(fac.department || "").trim();
    if (!dept) continue;
    if (!byDept[dept]) byDept[dept] = { indices: new Set(), facultyCount: 0 };
    byDept[dept].facultyCount += 1;
    for (const idx of facultyMap[fac.facultyId] ?? []) {
      byDept[dept].indices.add(idx);
    }
  }

  atlasDepartmentIndex = {};
  for (const [dept, entry] of Object.entries(byDept)) {
    atlasDepartmentIndex[dept] = {
      indices: [...entry.indices].sort((a, b) => a - b),
      facultyCount: entry.facultyCount,
    };
  }
  console.log(
    `[kg] department atlas index — ${Object.keys(atlasDepartmentIndex).length.toLocaleString()} departments`,
  );
  return atlasDepartmentIndex;
}

function departmentNameMatches(name, query, tokens) {
  const hay = String(name || "").toLowerCase();
  if (!hay) return false;
  if (hay.includes(query)) return true;
  if (tokens.length > 1) return tokens.every((t) => hay.includes(t));
  return false;
}

/** Paper atlas indices for one or more departments (exact names). */
kg.getDepartmentAtlasIndices = asyncErrorHandler(async (req, res) => {
  const deptIndex = ensureAtlasDepartmentIndex();
  if (!deptIndex) {
    throw new NotFoundError(
      "Department atlas index not available. Run knowledge-graph/pipeline/build_atlas.py first.",
    );
  }

  const rawNames = String(req.query.departments ?? "")
    .split("|")
    .map((name) => name.trim())
    .filter(Boolean);
  if (!rawNames.length) {
    return successResponse(res, { departments: [], matchCount: 0, indices: [] });
  }

  const indices = new Set();
  const resolved = [];
  for (const name of rawNames) {
    const entry = deptIndex[name];
    if (!entry) continue;
    resolved.push(name);
    for (const idx of entry.indices) indices.add(idx);
  }

  return successResponse(res, {
    departments: resolved,
    matchCount: indices.size,
    indices: [...indices],
  });
});

/** Search departments by name; returns matches + union of atlas paper indices. */
kg.searchAtlasDepartment = asyncErrorHandler(async (req, res) => {
  const deptIndex = ensureAtlasDepartmentIndex();
  if (!deptIndex) {
    throw new NotFoundError(
      "Department atlas index not available. Run knowledge-graph/pipeline/build_atlas.py first.",
    );
  }

  const q = String(req.query.q ?? "").trim().toLowerCase();
  const limit = Math.min(Number(req.query.limit) || 12, 50);
  if (!q) {
    return successResponse(res, { query: "", matches: [], matchCount: 0, indices: [] });
  }

  const tokens = q.split(/\s+/).filter((t) => t.length >= 2);
  const matched = Object.entries(deptIndex)
    .filter(([name]) => departmentNameMatches(name, q, tokens))
    .sort((a, b) => {
      const [aName, aEntry] = a;
      const [bName, bEntry] = b;
      const aHay = aName.toLowerCase();
      const bHay = bName.toLowerCase();
      const aExact = aHay === q ? 0 : 1;
      const bExact = bHay === q ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;
      const aStart = aHay.startsWith(q) ? 0 : 1;
      const bStart = bHay.startsWith(q) ? 0 : 1;
      if (aStart !== bStart) return aStart - bStart;
      return bEntry.indices.length - aEntry.indices.length;
    })
    .slice(0, limit);

  const indices = new Set();
  for (const [, entry] of matched) {
    for (const idx of entry.indices) indices.add(idx);
  }

  return successResponse(res, {
    query: q,
    matches: matched.map(([department, entry]) => ({
      department,
      facultyCount: entry.facultyCount,
      atlasCount: entry.indices.length,
    })),
    matchCount: indices.size,
    indices: [...indices],
  });
});

function atlasPaperMatchesQuery(paper, q) {
  const query = String(q ?? "").trim().toLowerCase();
  if (!query) return false;
  const haystack = [paper.title, paper.theme, paper.subdomain, paper.topic]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const tokens = query.split(/\s+/).filter((t) => t.length >= 2);
  if (tokens.length === 0) return haystack.includes(query);
  return tokens.every((t) => haystack.includes(t));
}

/** Theme cluster breakdown: departments + papers matching search within a broad theme. */
kg.getAtlasClusterBreakdown = asyncErrorHandler(async (req, res) => {
  if (!existsSync(ATLAS_FILE)) {
    throw new NotFoundError(
      "Atlas not found. Run knowledge-graph/pipeline/build_atlas.py first.",
    );
  }

  const theme = String(req.query.theme ?? "").trim();
  const q = String(req.query.q ?? "").trim();
  const paperLimit = Math.min(Number(req.query.paperLimit) || 200, 500);

  if (!theme || !q) {
    return successResponse(res, {
      theme,
      query: q,
      totalPapers: 0,
      departments: [],
    });
  }

  const raw = await readFile(ATLAS_FILE, "utf-8");
  const atlas = JSON.parse(raw);
  const deptIndex = ensureAtlasDepartmentIndex();

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

  /** @type {Map<string, { paperCount: number; papers: object[] }>} */
  const byDept = new Map();
  let totalPapers = 0;

  for (const paper of atlas.papers ?? []) {
    if (paper.theme !== theme) continue;
    if (!atlasPaperMatchesQuery(paper, q)) continue;
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
      if (entry.papers.length < paperLimit) {
        entry.papers.push({
          id: paper.id,
          i: paper.i,
          title: paper.title,
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

  return successResponse(res, {
    theme,
    query: q,
    totalPapers,
    departments,
  });
});

export default kg;
