import { asyncErrorHandler } from "../middleware/errorHandler.js";
import { successResponse } from "../lib/responseUtils.js";
import * as kgService from "../services/kgService.js";

const kg = {};

/** Preserves the route's existing init hook name; delegates to the service. */
export function initKgController() {
  kgService.initKg();
}

const sendKg = (res, { data, cached }) => {
  res.setHeader("X-Cache", cached ? "HIT" : "MISS");
  return successResponse(res, data);
};

kg.health = asyncErrorHandler(async (_req, res) => {
  const { data } = await kgService.getHealth();
  return successResponse(res, data);
});

kg.getFacultyIndex = asyncErrorHandler(async (_req, res) => {
  return sendKg(res, await kgService.getFacultyIndex());
});

kg.getFacultyGraph = asyncErrorHandler(async (req, res) => {
  return sendKg(res, await kgService.getFacultyGraph({ id: req.params.id }));
});

kg.getExploreTerms = asyncErrorHandler(async (req, res) => {
  return sendKg(res, await kgService.getExploreTerms({
    q: req.query.q,
    type: req.query.type,
    limit: req.query.limit,
  }));
});

kg.getExploreDetail = asyncErrorHandler(async (req, res) => {
  return sendKg(res, await kgService.getExploreDetail({ key: req.query.key }));
});

kg.getPaperMeta = asyncErrorHandler(async (req, res) => {
  return sendKg(res, await kgService.getPaperMeta({ id: req.params.id }));
});

kg.getAtlas = asyncErrorHandler(async (req, res) => {
  const { notModified, etag, body, cached } = await kgService.getAtlas({
    ifNoneMatch: req.headers["if-none-match"],
  });

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, must-revalidate");
  res.setHeader("ETag", etag);

  if (notModified) {
    return res.status(304).end();
  }
  res.setHeader("X-Cache", cached ? "HIT" : "MISS");
  return res.send(body);
});

kg.getAtlasTree = asyncErrorHandler(async (_req, res) => {
  return sendKg(res, await kgService.getAtlasTree());
});

kg.getAtlasDict = asyncErrorHandler(async (_req, res) => {
  return sendKg(res, await kgService.getAtlasDict());
});

kg.getAtlasTile = asyncErrorHandler(async (req, res) => {
  const { etag, payload } = await kgService.getAtlasTile({ nodeKey: req.params.nodeKey });
  if (req.headers["if-none-match"] === etag) {
    res.setHeader("ETag", etag);
    return res.status(304).end();
  }
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.setHeader("ETag", etag);
  return res.send(payload);
});

kg.getAtlasPoints = asyncErrorHandler(async (req, res) => {
  const indices = String(req.query.indices ?? "")
    .split(",")
    .map((s) => Number.parseInt(s, 10))
    .filter(Number.isFinite);
  return sendKg(res, await kgService.getAtlasPoints({ indices }));
});

kg.searchAtlas = asyncErrorHandler(async (req, res) => {
  return sendKg(res, await kgService.searchAtlas({ q: req.query.q, limit: req.query.limit }));
});

kg.getFacultyAtlasIndices = asyncErrorHandler(async (req, res) => {
  const ids = String(req.query.ids ?? "").split(",");
  return sendKg(res, await kgService.getFacultyAtlasIndices({ ids }));
});

kg.searchAtlasFaculty = asyncErrorHandler(async (req, res) => {
  return sendKg(res, await kgService.searchAtlasFaculty({ q: req.query.q, limit: req.query.limit }));
});

kg.getDepartmentAtlasIndices = asyncErrorHandler(async (req, res) => {
  const departments = String(req.query.departments ?? "").split("|");
  return sendKg(res, await kgService.getDepartmentAtlasIndices({ departments }));
});

kg.searchAtlasDepartment = asyncErrorHandler(async (req, res) => {
  return sendKg(res, await kgService.searchAtlasDepartment({ q: req.query.q, limit: req.query.limit }));
});

kg.getAtlasClusterBreakdown = asyncErrorHandler(async (req, res) => {
  return sendKg(res, await kgService.getAtlasClusterBreakdown({
    theme: req.query.theme,
    q: req.query.q,
    paperLimit: req.query.paperLimit,
  }));
});

export default kg;
