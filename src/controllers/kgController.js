import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { asyncErrorHandler } from "../middleware/errorHandler.js";
import { NotFoundError } from "../lib/customErrors.js";
import { successResponse } from "../lib/responseUtils.js";
import ResearchMetaDataScopus from "../models/research_scopus.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const KG_DATA_DIR = process.env.KG_DATA_DIR
  ? path.resolve(process.env.KG_DATA_DIR)
  : path.join(PROJECT_ROOT, "data", "knowledge-graph");
const GRAPHS_DIR = path.join(KG_DATA_DIR, "graphs");
const EXPLORE_FILE = path.join(KG_DATA_DIR, "explore_index.json");

let exploreIndex = { terms: [], detail: {} };

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

async function readJsonFile(filePath) {
  const raw = await readFile(filePath, "utf-8");
  return JSON.parse(raw);
}

const kg = {};

kg.health = asyncErrorHandler(async (_req, res) => {
  return successResponse(res, {
    graphsReady: existsSync(path.join(GRAPHS_DIR, "index.json")),
    exploreReady: (exploreIndex.terms?.length ?? 0) > 0,
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

/** Paper link metadata from MongoDB (node id format: p:<mongoId>). */
kg.getPaperMeta = asyncErrorHandler(async (req, res) => {
  const rawId = String(req.params.id).replace(/[^a-fA-F0-9]/g, "");
  if (!rawId) {
    throw new NotFoundError("Invalid paper id.");
  }
  const paper = await ResearchMetaDataScopus.findById(rawId)
    .select("link document_scopus_id document_eid title")
    .lean();
  if (!paper) {
    throw new NotFoundError(`No paper found for id '${rawId}'.`);
  }
  return successResponse(res, {
    link: paper.link ?? "",
    document_scopus_id: paper.document_scopus_id ?? "",
    document_eid: paper.document_eid ?? "",
    title: paper.title ?? "",
  });
});

export default kg;
