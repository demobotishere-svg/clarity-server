import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { bulkBatches, pendingMessages, leads } from "@/db/schema";
import { eq, and, isNull, lt } from "drizzle-orm";
import { sendWhatsAppTemplate } from "@/lib/whatsapp";

export async function GET(req: Request) {
  // Normally secure this via Cron Secret
  // const authHeader = req.headers.get("authorization");
  // if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) return new NextResponse("Unauthorized", { status: 401 });

  try {
    const now = new Date();
    
    // Find up to 5 pending messages (to process them 1 by 1 inside this invocation)
    const pendingList = await db.select({
      id: pendingMessages.id,
      leadId: pendingMessages.leadId,
      batchId: pendingMessages.batchId,
      templateName: pendingMessages.templateName
    })
    .from(pendingMessages)
    .where(
      and(
        eq(pendingMessages.status, "QUEUED"),
        // Ignore locked messages unless the lock is older than 5 minutes (stale lock)
        // For simplicity, we just look for unlocked (lockedAt IS NULL)
        isNull(pendingMessages.lockedAt) 
      )
    )
    .limit(5);

    if (pendingList.length === 0) {
      return NextResponse.json({ success: true, processed: 0, message: "Queue empty" });
    }

    // Lock them immediately
    for (const msg of pendingList) {
      await db.update(pendingMessages)
        .set({ lockedAt: now, status: "PROCESSING" })
        .where(eq(pendingMessages.id, msg.id));
    }

    let processedCount = 0;

    for (const msg of pendingList) {
      // Find lead phone and name
      const leadResults = await db.select({ phone: leads.phone, name: leads.name }).from(leads).where(eq(leads.id, msg.leadId));
      
      let finalStatus = "FAILED";
      let errorReason = "Lead not found or missing phone";
      let wamid = null;

      if (leadResults.length > 0) {
        const phone = leadResults[0].phone;
        const name = leadResults[0].name;
        
        try {
          const resData = await sendWhatsAppTemplate(phone, msg.templateName, "en", [
            {
              type: "header",
              parameters: [
                { type: "text", parameter_name: "name", text: name || "User" }
              ]
            }
          ]);
          
          if (resData?.messages?.[0]?.id) {
            wamid = resData.messages[0].id;
          }
          
          finalStatus = "SENT";
          errorReason = "";
        } catch (err: any) {
          finalStatus = "FAILED";
          errorReason = err.message || "WhatsApp API Error";
        }
      }

      // Update message status
      await db.update(pendingMessages)
          .set({ 
            status: finalStatus, 
            errorReason: errorReason,
            messageId: wamid,
            processedAt: new Date() 
          }).where(eq(pendingMessages.id, msg.id));
        
      // Update Batch counts
      const batchResult = await db.select().from(bulkBatches).where(eq(bulkBatches.id, msg.batchId));
      if (batchResult.length > 0) {
        const batch = batchResult[0];
        const newProcessed = finalStatus === "SENT" ? batch.processedCount + 1 : batch.processedCount;
        const newFailed = finalStatus === "FAILED" ? batch.failedCount + 1 : batch.failedCount;
        
        let newStatus = batch.status;
        if ((newProcessed + newFailed) >= batch.totalCount) {
          if (newFailed === batch.totalCount) newStatus = "FAILED";
          else if (newFailed > 0) newStatus = "PARTIAL";
          else newStatus = "COMPLETED";
        }

        await db.update(bulkBatches).set({ 
          processedCount: newProcessed,
          failedCount: newFailed,
          status: newStatus
        }).where(eq(bulkBatches.id, msg.batchId));
      }

      processedCount++;
      
      // Wait exactly 1 second before processing the next one to respect Meta limits
      if (processedCount < pendingList.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    return NextResponse.json({ success: true, processed: processedCount });
  } catch (error) {
    console.error("Cron Worker Error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
