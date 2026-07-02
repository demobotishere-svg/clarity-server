import { Worker } from "bullmq";
import { redisConnection } from "../lib/redis";
import { db } from "../lib/db";
import { assessments, activityLogs, leads, pendingMessages, bulkBatches, messages as messagesTable } from "../db/schema";
import { eq, isNotNull } from "drizzle-orm";
import { sendWhatsAppMessage, sendWhatsAppDocument, sendWhatsAppTemplate } from "../lib/whatsapp";
import { generateReportPDF } from "../lib/pdf";
import { generateId } from "../lib/db";
import { QUEUES } from "../queues/queue";

// ==========================================
// PDF GENERATION WORKER
// ==========================================
export const pdfWorker = new Worker(
  QUEUES.PDF_GENERATION,
  async (job) => {
    const { uniqueId, leadName, qaPairs, reportMarkdown, score, paymentLinkUrl, baseUrl, phone, assessmentId, leadId } = job.data;
    console.log(`[PDF Worker] Processing job ${job.id} for lead ${leadName}`);

    let pdfFileName = "";
    let pdfUrl = "";

    try {
      pdfFileName = await generateReportPDF(uniqueId, leadName, qaPairs, reportMarkdown, score, paymentLinkUrl);
      pdfUrl = `${baseUrl}/reports/${pdfFileName}`;
    } catch (error) {
      console.error("[PDF Worker] PDF generation failed:", error);
      throw error; // Will be retried by BullMQ
    }

    // Save PDF URL to assessment
    await db.update(assessments)
      .set({
        pdfUrl: pdfUrl,
        updatedAt: new Date()
      })
      .where(eq(assessments.id, assessmentId));

    await db.insert(activityLogs).values({
      id: generateId(),
      leadId: leadId,
      action: "REPORT_GENERATED",
      details: JSON.stringify({ score, pdfGenerated: true, workerJobId: job.id })
    });

    // Dispatch WhatsApp Message
    const textMsg = `*Assessment Complete!*\n\nWe have analyzed your inputs. You scored an AI Readiness Rating of *${score}/100*.\n\nPlease find your detailed strategic analysis and personalized recommendations in the PDF below.\n\nReady to scale your business? *Join Clarity Now:* ${paymentLinkUrl}`;
    
    await sendWhatsAppMessage(phone, textMsg);
    
    // Log system message
    await db.insert(messagesTable).values({
      id: generateId(),
      assessmentId,
      role: "SYSTEM",
      content: textMsg,
    });

    await sendWhatsAppDocument(phone, pdfUrl, `${leadName}_Analysis.pdf`, "Your AI Strategy Report");

    await db.insert(activityLogs).values({
      id: generateId(),
      leadId: leadId,
      action: "PDF_SENT_TO_WHATSAPP",
      details: JSON.stringify({ success: true })
    });

    console.log(`[PDF Worker] Successfully completed job ${job.id}`);
  },
  { 
    connection: redisConnection as any,
    concurrency: 3 // Replaces p-limit(3)
  }
);

pdfWorker.on("failed", async (job, err) => {
  console.error(`[PDF Worker] Job ${job?.id} failed with error:`, err);
  if (job && job.attemptsMade >= job.opts.attempts!) {
    console.log(`[PDF Worker] Job ${job.id} permanently failed after ${job.attemptsMade} attempts.`);
    try {
      await sendWhatsAppMessage(job.data.phone, "Oops! Your report was so packed with insights that our PDF engine timed out. Type 'Retry' to generate it again!");
    } catch(e) {}
  }
});

// ==========================================
// BULK MESSAGE WORKER
// ==========================================
export const bulkWorker = new Worker(
  QUEUES.BULK_MESSAGE,
  async (job) => {
    const { id, leadId, phone, name, templateName, isSubscribed, paymentLink, batchId } = job.data;
    console.log(`[Bulk Worker] Processing msg ${id} for ${phone}`);

    const now = new Date();
    await db.update(pendingMessages).set({ lockedAt: now, status: "PROCESSING" }).where(eq(pendingMessages.id, id));

    let finalStatus = "FAILED";
    let errorReason = "Unknown error";
    let wamid = null;

    if (isSubscribed === false) {
      errorReason = "User has unsubscribed";
    } else if (!phone) {
      errorReason = "Missing phone number";
    } else {
      try {
        let components: any[] = [];
        
        if (templateName === "utl_payment_abandoned") {
          const paymentLinkUrl = paymentLink || process.env.RAZORPAY_PAYMENT_LINK || "https://rzp.io/rzp/XW1Jd0p";
          components = [
            { type: "header", parameters: [{ type: "text", parameter_name: "name", text: name || "User" }] },
            { type: "body", parameters: [{ type: "text", parameter_name: "paymentlink", text: paymentLinkUrl }] }
          ];
        } else if (templateName === "utl_assessment_abandoned") {
          components = [
            { type: "header", parameters: [{ type: "text", parameter_name: "name", text: name || "User" }] }
          ];
        } else {
          components = [
            { type: "header", parameters: [{ type: "text", parameter_name: "name", text: name || "User" }] }
          ];
        }

        const resData = await sendWhatsAppTemplate(phone, templateName, "en", components);
      
        if (resData?.messages?.[0]?.id) {
          wamid = resData.messages[0].id;
        }
        
        finalStatus = "SENT";
        errorReason = "";
      } catch (err: any) {
        finalStatus = "FAILED";
        errorReason = err.message || "WhatsApp API Error";
        throw err; // Trigger BullMQ retry
      }
    }

    // Update message status
    await db.update(pendingMessages)
      .set({ 
        status: finalStatus, 
        errorReason: errorReason,
        messageId: wamid,
        processedAt: new Date() 
      })
      .where(eq(pendingMessages.id, id));
    
    // Update batch counts
    const batchResult = await db.select().from(bulkBatches).where(eq(bulkBatches.id, batchId));
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
      }).where(eq(bulkBatches.id, batchId));
    }
  },
  { 
    connection: redisConnection as any,
    concurrency: 5, // Process 5 messages simultaneously 
    limiter: {
      max: 50,
      duration: 1000 // Rate limit: Max 50 templates per second (Meta limit safety)
    }
  }
);

bulkWorker.on("failed", async (job, err) => {
  console.error(`[Bulk Worker] Job ${job?.id} failed with error:`, err);
  if (job && job.data.id) {
    // If it permanently fails after retries
    if (job.attemptsMade >= job.opts.attempts!) {
      await db.update(pendingMessages)
        .set({ 
          status: "FAILED", 
          errorReason: err.message || "Max retries exceeded",
          processedAt: new Date() 
        })
        .where(eq(pendingMessages.id, job.data.id));
        
      // Update batch fail count
      const batchResult = await db.select().from(bulkBatches).where(eq(bulkBatches.id, job.data.batchId));
      if (batchResult.length > 0) {
        const batch = batchResult[0];
        const newFailed = batch.failedCount + 1;
        let newStatus = batch.status;
        if ((batch.processedCount + newFailed) >= batch.totalCount) {
           newStatus = newFailed === batch.totalCount ? "FAILED" : "PARTIAL";
        }
        await db.update(bulkBatches).set({ 
          failedCount: newFailed,
          status: newStatus
        }).where(eq(bulkBatches.id, job.data.batchId));
      }
    }
  }
});
