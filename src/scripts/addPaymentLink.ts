import "dotenv/config";
import { db } from "../lib/db";
import { sql } from "drizzle-orm";

async function main() {
  try {
    await db.execute(sql`ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "paymentLink" text;`);
    console.log("Added paymentLink column to Lead table.");
  } catch (error) {
    console.error("Migration error:", error);
  }
  process.exit(0);
}

main();
