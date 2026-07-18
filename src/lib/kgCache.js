import { ensureRedisConnected, redisClient } from "./redis.js";

/** Default Redis TTL for KG JSON caches (seconds). */
export const KG_CACHE_TTL_S = Number(process.env.KG_CACHE_TTL_S) || 10_800;

export function kgCacheKey(version, ...parts) {
  const suffix = parts.map((p) => encodeURIComponent(String(p))).join(":");
  return `kg:${version}:${suffix}`;
}

export async function kgCacheGet(key) {
  try {
    if (!(await ensureRedisConnected())) return null;
    return await redisClient.get(key);
  } catch {
    return null;
  }
}

export async function kgCacheSet(key, value, ttl = KG_CACHE_TTL_S) {
  try {
    if (!(await ensureRedisConnected())) return;
    await redisClient.setEx(key, ttl, value);
  } catch {
    /* fail-open */
  }
}
