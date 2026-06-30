import "dotenv/config";
import { db } from "../lib/db";
import { razorpayPayments } from "../db/schema";
import { isNull } from "drizzle-orm";

async function main() {
  console.log("Deleting orphaned payments (where leadId is null)...");
  await db.delete(razorpayPayments).where(isNull(razorpayPayments.leadId));
  console.log("Done!");
  process.exit(0);
}

main();
