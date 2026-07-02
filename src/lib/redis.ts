import { Redis } from "ioredis";

export const redisConnection = new Redis({
  host: process.env.REDIS_HOST,
  port: Number(process.env.REDIS_PORT),
  username: process.env.REDIS_USERNAME,
  password: process.env.REDIS_PASSWORD,
  db: Number(process.env.REDIS_DB),
  tls: process.env.REDIS_HOST?.includes("upstash.io") ? {} : undefined,
  maxRetriesPerRequest: null,
});

redisConnection.on("error", (error) => {
  console.error("Redis connection error:", error);
});

redisConnection.on("ready", () => {
  console.log("Redis connected successfully");
});
