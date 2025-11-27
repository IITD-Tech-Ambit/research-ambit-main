import { createClient } from "redis";
import dotenv from "dotenv";

dotenv.config();

export const redisClient = createClient({
  password: process.env.REDIS_DB_PASS,
  socket: {
    host: process.env.REDIS_DB_HOST,
    port: process.env.REDIS_DB_PORT
      ? parseInt(process.env.REDIS_DB_PORT)
      : 16061,
  },
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
