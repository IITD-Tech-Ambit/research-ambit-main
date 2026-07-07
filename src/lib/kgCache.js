import { existsSync, statSync } from "node:fs";

import { ensureRedisConnected, redisClient } from "./redis.js";
export const KG_CACHE_TTL_S = Number(process.env.KG_CACHE_TTL_S) || 10_800;

/** @param {string} filePath */
export function fileVersion(filePath) {
  try {
    if (!existsSync(filePath)) return "0";
    const stat = statSync(filePath);
    return `${stat.mtimeMs}-${stat.size}`;
  } catch {
    return "0";
  }
}

/** Build a version stamp from KG data files (auto-invalidates after pipeline rebuild). */
export function kgDataVersion(paths) {
  return paths.map((p) => fileVersion(p)).join("|");
}

/** @param {string[]} parts */
export function kgCacheKey(version, ...parts) {
  const suffix = parts.map((p) => encodeURIComponent(String(p))).join(":");
  return `kg:${version}:${suffix}`;
}

/** @param {string} key */
export async function kgCacheGet(key) {
  try {
    if (!(await ensureRedisConnected())) return null;
    return await redisClient.get(key);
  } catch {
    return null;
  }
}

/**
 * @param {string} key
 * @param {string} value
 * @param {number} [ttl]
 */
export async function kgCacheSet(key, value, ttl = KG_CACHE_TTL_S) {
  try {
    if (!(await ensureRedisConnected())) return;
    await redisClient.setEx(key, ttl, value);
  } catch {
    /* fail-open */
  }
}
/**
 * @param {import("express").Response} res
 * @param {string} key
 * @param {() => Promise<unknown>} loadData
 */
export async function sendCachedSuccess(res, key, loadData) {
  const cached = await kgCacheGet(key);
  if (cached) {
    res.setHeader("X-Cache", "HIT");
    return res.status(200).json(JSON.parse(cached));
  }

  const data = await loadData();
  const payload = {
    success: true,
    message: "Success",
    data,
    timestamp: new Date().toISOString(),
  };
  await kgCacheSet(key, JSON.stringify(payload));
  res.setHeader("X-Cache", "MISS");
  return res.status(200).json(payload);
}
