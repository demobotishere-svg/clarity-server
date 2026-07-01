import rateLimit from "express-rate-limit";
import RedisStore from "rate-limit-redis";
import Redis from "ioredis";

// Conditionally create Redis client
let redisClient: Redis | undefined;
if (process.env.REDIS_URL) {
  redisClient = new Redis(process.env.REDIS_URL);
  redisClient.on("error", (err) => console.error("Redis Rate Limiter Error:", err));
}

const getStore = (prefix: string) => {
  if (redisClient) {
    return new RedisStore({
      sendCommand: (...args: string[]) => redisClient!.call(...args),
      prefix,
    });
  }
  return undefined; // Falls back to default MemoryStore
};

// Limit login/register attempts
export const authLimiter = rateLimit({
  store: getStore("rate-limit:auth:"),
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 requests per `window` (here, per 15 minutes)
  message: { error: "Too many login attempts from this IP, please try again after 15 minutes" },
  standardHeaders: true,
  legacyHeaders: false,
});

// Limit lead creation to prevent waitlist spam (and WhatsApp cost accumulation)
export const leadsLimiter = rateLimit({
  store: getStore("rate-limit:leads:"),
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // Limit each IP to 5 form submissions per hour
  message: { error: "Too many signups from this IP. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

// General API rate limiter
export const apiLimiter = rateLimit({
  store: getStore("rate-limit:api:"),
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, 
  message: { error: "Too many requests from this IP, please try again after 15 minutes" },
  standardHeaders: true,
  legacyHeaders: false,
});
