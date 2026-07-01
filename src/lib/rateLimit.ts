import { db, generateId } from "../lib/db";
import { rateLimits } from "../db/schema";
import { eq, and, sql, gt } from "drizzle-orm";

export async function checkRateLimit(ip: string, endpoint: string, maxHits: number, windowMinutes: number): Promise<boolean> {
  const now = new Date();
  
  // Clean up old rate limits for this IP/endpoint (to keep table small)
  // Find current active window
  const activeLimitList = await db.select()
    .from(rateLimits)
    .where(
      and(
        eq(rateLimits.ip, ip),
        eq(rateLimits.endpoint, endpoint),
        gt(rateLimits.windowReset, now)
      )
    );

  if (activeLimitList.length > 0) {
    const activeLimit = activeLimitList[0];
    if (activeLimit.hits >= maxHits) {
      return false; // Rate limit exceeded
    }
    
    await db.update(rateLimits)
      .set({ hits: activeLimit.hits + 1 })
      .where(eq(rateLimits.id, activeLimit.id));
    return true;
  } else {
    // Create new rate limit window
    const windowReset = new Date(now.getTime() + windowMinutes * 60000);
    await db.insert(rateLimits).values({
      id: generateId(),
      ip,
      endpoint,
      hits: 1,
      windowReset,
    });
    return true;
  }
}
