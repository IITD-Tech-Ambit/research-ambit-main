import { createClient } from "redis";
import dotenv from "dotenv";

dotenv.config();

export const redisClient = createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",
});
redisClient.on("connect", () => {
  console.log("Connected to Redis!");
});

redisClient.on("ready", () => {
  console.log("Redis client ready for commands.");
});

redisClient.on("error", (err) => {
  console.error("Redis Client Error:", err);
});

export async function connectToRedis() {
  try {
    await redisClient.connect();
    console.log("Successfully connected to Redis");
  } catch (err) {
    console.error("Error connecting to Redis:", err);
  }
}
