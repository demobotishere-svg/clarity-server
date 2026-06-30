import { NextResponse } from "next/server";
import { db, generateId } from "@/lib/db";
import { bulkBatches, pendingMessages, leads } from "@/db/schema";
import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import { inArray } from "drizzle-orm";

const getJwtSecretKey = () => {
  const secret = process.env.JWT_SECRET || "fallback_secret_key_change_me";
  return new TextEncoder().encode(secret);
};

export async function POST(req: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("admin_token")?.value;
    if (!token) return new NextResponse("Unauthorized", { status: 401 });

    const { payload } = await jwtVerify(token, getJwtSecretKey());
    const adminId = payload.id as string;

    const { leadIds, templateName } = await req.json();

    if (!Array.isArray(leadIds) || leadIds.length === 0 || !templateName) {
      return new NextResponse("Invalid payload", { status: 400 });
    }

    // Verify leads exist
    const validLeads = await db.select({ id: leads.id }).from(leads).where(inArray(leads.id, leadIds));
    const validLeadIds = validLeads.map(l => l.id);

    if (validLeadIds.length === 0) {
      return new NextResponse("No valid leads provided", { status: 400 });
    }

    const batchId = generateId();

    // Create Batch
    await db.insert(bulkBatches).values({
      id: batchId,
      adminId,
      templateName,
      totalCount: validLeadIds.length,
    });

    // Create Queue Entries
    const queueEntries = validLeadIds.map(leadId => ({
      id: generateId(),
      batchId,
      leadId,
      templateName,
    }));

    await db.insert(pendingMessages).values(queueEntries);

    // Automatically trigger the queue processor in the background
    // We don't await this fetch so it doesn't block the UI response!
    fetch(new URL("/api/cron/process-queue", req.url).toString(), { method: "GET" })
      .catch(err => console.error("Auto-process trigger failed:", err));

    return NextResponse.json({ success: true, batchId, queuedCount: validLeadIds.length });
  } catch (error) {
    console.error("Bulk Queue Error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
