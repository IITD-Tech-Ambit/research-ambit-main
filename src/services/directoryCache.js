import crypto from "node:crypto";
import { cacheGet, cacheSetEx } from "../lib/cache.js";

export const CACHE_TTL_S = parseInt(process.env.FACULTY_CACHE_TTL_S) || 10800;

// Short TTL relative to CACHE_TTL_S: search is keyed by free-typed query text,
// so cardinality is much higher than the other cached endpoints here — a long
// TTL would let Redis accumulate a huge number of rarely-reused keys.
export const SEARCH_CACHE_TTL_S = 300;

// Bumped from `dir:` → `dir:v2:` so this process's responses are not overwritten
// by an older backend that still shares the same Redis (local + prod both point
// at 10.17.8.24). Old keys remain until TTL; clearDirectoryCache deletes both.
export const DIR_CACHE_PREFIX = "dir:v2";

export const dirCacheKey = (...parts) => `${DIR_CACHE_PREFIX}:${parts.join(":")}`;

// Caches only the `{ data, message }` pair (not the full envelope): the
// `success`/`timestamp` wrapper is rebuilt fresh by each transport, so the same
// cached value serves both REST (envelope) and gRPC (typed message) callers.
export const cachedPayload = async (cacheKey, ttl, build) => {
    const cached = await cacheGet(cacheKey);
    if (cached) {
        const { data, message } = JSON.parse(cached);
        return { data, message, cached: true };
    }
    const { data, message } = await build();
    await cacheSetEx(cacheKey, ttl, JSON.stringify({ data, message }));
    return { data, message, cached: false };
};

// Batch-resolve endpoints are keyed by an arbitrary id set — hash the sorted,
// deduped ids so the cache key stays bounded regardless of batch size.
export const batchCacheKey = (prefix, ids) => {
    const hash = crypto.createHash("sha256").update([...ids].sort().join(",")).digest("hex").slice(0, 16);
    return dirCacheKey(prefix, hash);
};
