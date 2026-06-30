import "dotenv/config";
import { db } from "../lib/db";
import { sql } from "drizzle-orm";

async function main() {
  console.log("Creating RazorpayPayment table...");
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "RazorpayPayment" (
        "id" text PRIMARY KEY NOT NULL,
        "leadId" text,
        "paymentId" text NOT NULL,
        "orderId" text,
        "amount" integer NOT NULL,
        "currency" text NOT NULL,
        "status" text NOT NULL,
        "method" text,
        "contact" text,
        "email" text,
        "cardNetwork" text,
        "cardLast4" text,
        "fee" integer,
        "tax" integer,
        "createdAt" timestamp(3) DEFAULT now() NOT NULL
      );
    `);
    
    // Attempt to add foreign key, ignore if it already exists
    try {
      await db.execute(sql`
        ALTER TABLE "RazorpayPayment" 
        ADD CONSTRAINT "RazorpayPayment_leadId_fkey" 
        FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE set null ON UPDATE cascade;
      `);
      console.log("Added foreign key constraint.");
    } catch (fkError: any) {
      if (fkError.message && fkError.message.includes("already exists")) {
        console.log("Foreign key constraint already exists.");
      } else {
        throw fkError;
      }
    }

    console.log("Successfully created RazorpayPayment table!");
  } catch (error) {
    console.error("Migration failed:", error);
  }
  process.exit(0);
}

main();
