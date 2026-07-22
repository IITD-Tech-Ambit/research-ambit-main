/** One-off: delete cached directory responses (dir:* keys) from Redis. */
import dotenv from "dotenv";
import { createClient } from "redis";

dotenv.config();

const client = createClient({ url: process.env.REDIS_URL });
await client.connect();

let deleted = 0;
for await (const key of client.scanIterator({ MATCH: "dir:*", COUNT: 200 })) {
  await client.del(key);
  deleted++;
}
console.log(`Deleted ${deleted} dir:* cache keys`);
await client.quit();
