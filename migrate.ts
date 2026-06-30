import "dotenv/config";
import { db } from "./lib/db";
import { sql } from "drizzle-orm";

async function main() {
  console.log("Adding new columns to Lead table...");
  try {
    await db.execute(sql`ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "hasPaid" boolean DEFAULT false;`);
    await db.execute(sql`ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "paymentId" text;`);
    console.log("Successfully updated Lead table!");
  } catch (error) {
    console.error("Migration failed:", error);
  }
  process.exit(0);
}

main();
