import { ensureRedisConnected, redisClient } from "./redis.js";

/**
 * Generic fail-open Redis cache helpers. Was duplicated near-verbatim in
 * directoryController.js and cms.js. Uses ensureRedisConnected (connect on
 * demand) rather than just checking .isOpen, so a cold-start request doesn't
 * silently skip the cache before the startup connectToRedis() call resolves.
 */

export async function cacheGet(key) {
    try {
        if (!(await ensureRedisConnected())) return null;
        return await redisClient.get(key);
    } catch {
        return null;
    }
}

export async function cacheSetEx(key, ttl, value) {
    try {
        if (!(await ensureRedisConnected())) return;
        await redisClient.setEx(key, ttl, value);
    } catch {
        /* fail-open */
    }
}

/**
 * Delete every key matching `${prefix}*` (SCAN-based, non-blocking). Used to
 * invalidate cached directory payloads after a write so the change (e.g. a new
 * profile image) shows immediately everywhere. Fail-open: returns count deleted.
 */
export async function cacheDelByPrefix(prefix) {
    try {
        if (!(await ensureRedisConnected())) return 0;
        let deleted = 0;
        for await (const keys of redisClient.scanIterator({ MATCH: `${prefix}*`, COUNT: 200 })) {
            if (keys && keys.length) {
                await redisClient.del(keys);
                deleted += keys.length;
            }
        }
        return deleted;
    } catch {
        return 0;
    }
}
