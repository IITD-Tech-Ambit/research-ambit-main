/** Delete cached directory responses from Redis (dir:v2:* and legacy dir:*). */
import "dotenv/config";
import { createClient } from "redis";

const client = createClient({ url: process.env.REDIS_URL });
await client.connect();

let deleted = 0;
for (const pattern of ["dir:v2:*", "dir:*"]) {
    for await (const key of client.scanIterator({ MATCH: pattern, COUNT: 200 })) {
        if (!key) continue;
        await client.del(key);
        deleted += 1;
    }
}
console.log(`Deleted ${deleted} directory cache keys (dir:v2:* + legacy dir:*)`);
await client.quit();
