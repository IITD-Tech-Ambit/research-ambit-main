import { createClient } from "redis";
import dotenv from "dotenv";

dotenv.config();

export const redisClient = createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",
  socket: {
    connectTimeout: 5_000,
    reconnectStrategy: (retries) => (retries > 2 ? false : Math.min(retries * 200, 1_000)),
  },
});

/** @type {Promise<boolean> | null} */
let connectPromise = null;

redisClient.on("connect", () => {
  console.log("Connected to Redis!");
});

redisClient.on("ready", () => {
  console.log("Redis client ready for commands.");
});

redisClient.on("error", (err) => {
  console.error("Redis Client Error:", err);
});

/** Connect on demand (safe for serverless cold starts and early KG requests). */
export async function ensureRedisConnected() {
  if (redisClient.isOpen) return true;
  if (!connectPromise) {
    connectPromise = (async () => {
      try {
        await redisClient.connect();
        console.log("Successfully connected to Redis");
        return true;
      } catch (err) {
        connectPromise = null;
        console.error("Error connecting to Redis:", err);
        return false;
      }
    })();
  }
  return connectPromise;
}

export async function connectToRedis() {
  await ensureRedisConnected();
}
