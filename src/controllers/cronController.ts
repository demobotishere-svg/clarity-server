import { Request, Response } from "express";
import { db } from "../lib/db";
import { bulkBatches, pendingMessages, leads } from "../db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { sendWhatsAppTemplate } from "../lib/whatsapp";

export const processQueue = async (req: Request, res: Response) => {
  try {
    const now = new Date();
    
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
        isNull(pendingMessages.lockedAt) 
      )
    )
    .limit(5);

    if (pendingList.length === 0) {
      return res.json({ success: true, processed: 0, message: "Queue empty" });
    }

    for (const msg of pendingList) {
      await db.update(pendingMessages)
        .set({ lockedAt: now, status: "PROCESSING" })
        .where(eq(pendingMessages.id, msg.id));
    }

    let processedCount = 0;

    for (const msg of pendingList) {
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

      await db.update(pendingMessages)
          .set({ 
            status: finalStatus, 
            errorReason: errorReason,
            messageId: wamid,
            processedAt: new Date() 
          }).where(eq(pendingMessages.id, msg.id));
        
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
      
      if (processedCount < pendingList.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    return res.json({ success: true, processed: processedCount });
  } catch (error) {
    console.error("Cron Worker Error:", error);
    return res.status(500).send("Internal Server Error");
  }
};
