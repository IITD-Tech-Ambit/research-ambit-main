/** Delete cached directory responses from Redis (dir:v2:* and legacy dir:*). */
import "dotenv/config";
import { createClient } from "redis";

const client = createClient({ url: process.env.REDIS_URL });
await client.connect();

let deleted = 0;
for (const pattern of ["dir:v2:*", "dir:*"]) {
    // redis@5's scanIterator yields batches (arrays) of keys, not one key at a time.
    for await (const keys of client.scanIterator({ MATCH: pattern, COUNT: 200 })) {
        if (!keys || keys.length === 0) continue;
        await client.del(keys);
        deleted += keys.length;
    }
}
console.log(`Deleted ${deleted} directory cache keys (dir:v2:* + legacy dir:*)`);
await client.quit();
