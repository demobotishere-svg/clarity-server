import "dotenv/config";
import { db } from "../lib/db";
import { sql } from "drizzle-orm";

async function main() {
  try {
    await db.execute(sql`ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "isSubscribed" boolean DEFAULT true;`);
    console.log("Added isSubscribed column to Lead table.");
  } catch (error) {
    console.error("Migration error:", error);
  }
  process.exit(0);
}

main();
