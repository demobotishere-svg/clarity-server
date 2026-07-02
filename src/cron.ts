import { db } from "./lib/db";
import { pendingMessages, leads } from "./db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { bulkMessageQueue } from "./queues/queue";

const POLL_INTERVAL = 10000; // 10 seconds

export function startCron() {
  console.log(`[Cron] Starting bulk message polling every ${POLL_INTERVAL}ms`);
  
  setInterval(async () => {
    try {
      const now = new Date();
      
      // Select pending messages that are QUEUED and not locked
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
      .limit(20);

      if (pendingList.length === 0) return;

      console.log(`[Cron] Found ${pendingList.length} queued messages. Pushing to BullMQ...`);

      // Lock them so they aren't picked up twice
      for (const msg of pendingList) {
        await db.update(pendingMessages)
          .set({ lockedAt: now }) // We set lockedAt but keep status QUEUED, Worker will change to PROCESSING
          .where(eq(pendingMessages.id, msg.id));
      }

      for (const msg of pendingList) {
        const leadResults = await db.select({ 
          phone: leads.phone, 
          name: leads.name, 
          isSubscribed: leads.isSubscribed,
          paymentLink: leads.paymentLink
        }).from(leads).where(eq(leads.id, msg.leadId));

        if (leadResults.length > 0) {
          const lead = leadResults[0];
          await bulkMessageQueue.add("send-template", {
            id: msg.id,
            leadId: msg.leadId,
            phone: lead.phone,
            name: lead.name,
            templateName: msg.templateName,
            isSubscribed: lead.isSubscribed,
            paymentLink: lead.paymentLink,
            batchId: msg.batchId
          });
        } else {
          // If lead doesn't exist, instantly fail it
          await db.update(pendingMessages)
            .set({ status: "FAILED", errorReason: "Lead not found" })
            .where(eq(pendingMessages.id, msg.id));
        }
      }

    } catch (error) {
      console.error("[Cron] Polling error:", error);
    }
  }, POLL_INTERVAL);
}
