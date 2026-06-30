import "dotenv/config";
import { db } from "../lib/db";
import { razorpayPayments } from "../db/schema";
import { desc } from "drizzle-orm";

async function main() {
  console.log("Fetching razorpay payments...");
  const payments = await db.select().from(razorpayPayments).orderBy(desc(razorpayPayments.createdAt));
  console.log("Total payments found:", payments.length);
  
  if (payments.length > 0) {
    console.log("Most recent payments:");
    console.log(JSON.stringify(payments.slice(0, 3), null, 2));
  } else {
    console.log("Table is empty.");
  }
  
  console.log("\nFetching leads...");
  const allLeads = await db.query.leads.findMany();
  console.log("Total leads:", allLeads.length);
  console.log(JSON.stringify(allLeads, null, 2));
  
  process.exit(0);
}

main();
