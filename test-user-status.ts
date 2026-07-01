import "dotenv/config";
import { db } from "./src/lib/db";
import { leads, assessments, messages } from "./src/db/schema";
import { eq } from "drizzle-orm";

async function run() {
  const allLeads = await db.query.leads.findMany({
    with: { assessment: true }
  });
  console.log("All leads:", JSON.stringify(allLeads, null, 2));

  const allMessages = await db.query.messages.findMany();
  console.log("All messages:", JSON.stringify(allMessages, null, 2));
}

run().catch(console.error).finally(() => process.exit(0));
