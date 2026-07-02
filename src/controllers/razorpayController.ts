import { Request, Response } from "express";
import crypto from "crypto";
import { db, generateId } from "../lib/db";
import { leads, activityLogs, messages as messagesTable, razorpayPayments, admins } from "../db/schema";
import { ilike, eq, isNotNull } from "drizzle-orm";
import { sendWhatsAppTemplate } from "../lib/whatsapp";

const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;

if (!RAZORPAY_WEBHOOK_SECRET) {
  console.warn("CRITICAL: RAZORPAY_WEBHOOK_SECRET is not set. Payments will fail.");
}

export const handleRazorpayWebhook = async (req: Request, res: Response) => {
  try {
    const rawBody = (req as any).rawBody || JSON.stringify(req.body);
    const signature = req.headers["x-razorpay-signature"] as string;

    if (!signature) {
      return res.status(400).send("Missing Signature");
    }

    if (!RAZORPAY_WEBHOOK_SECRET) {
      return res.status(500).send("Server Configuration Error");
    }

    const expectedSignature = crypto
      .createHmac("sha256", RAZORPAY_WEBHOOK_SECRET)
      .update(rawBody)
      .digest("hex");

    if (expectedSignature !== signature) {
      console.error("Invalid Razorpay Webhook Signature");
      return res.status(400).send("Invalid Signature");
    }

    const payload = req.body;
    console.log("Full Razorpay Webhook Payload:", JSON.stringify(payload, null, 2));

    // Replay Attack Protection: check if webhook is older than 5 minutes
    if (payload.created_at) {
      const webhookTime = payload.created_at * 1000;
      const currentTime = Date.now();
      if (currentTime - webhookTime > 5 * 60 * 1000) {
        console.warn("Razorpay Webhook: Rejected old webhook (possible replay attack).");
        return res.status(400).send("Webhook Expired");
      }
    }

    if (payload.event === "payment.link.paid" || payload.event === "payment.captured") {
      const paymentEntity = payload.payload.payment?.entity || payload.payload.payment_link?.entity;
      const paymentLinkEntity = payload.payload.payment_link?.entity;
      
      const serviceFromNotes = paymentEntity?.notes?.service || paymentLinkEntity?.notes?.service;
      if (serviceFromNotes !== "clarity app") {
        console.warn(`Razorpay Webhook: Ignored payment for different service (${serviceFromNotes || 'unknown'})`);
        return res.status(200).send("OK");
      }
      
      const leadIdFromNotes = paymentEntity?.notes?.leadId || paymentLinkEntity?.notes?.leadId;
      const leadIdFromReference = paymentEntity?.reference_id || paymentLinkEntity?.reference_id;
      const exactLeadId = leadIdFromNotes || leadIdFromReference;

      let lead: any = null;

      if (exactLeadId) {
        lead = await db.query.leads.findFirst({
          where: eq(leads.id, exactLeadId),
          with: { assessment: true }
        });
      }

      if (!lead) {
        const rawPhone = paymentEntity?.contact || paymentEntity?.customer?.contact;
        
        if (rawPhone) {
          let formattedPhone = String(rawPhone).replace(/[^0-9]/g, "");
          const searchPhone = formattedPhone.length > 10 ? formattedPhone.slice(-10) : formattedPhone;
          
          lead = await db.query.leads.findFirst({
            where: ilike(leads.phone, `%${searchPhone}%`),
            with: { assessment: true }
          });
        }
      }

      await db.insert(razorpayPayments).values({
        id: generateId(),
        leadId: lead ? lead.id : null,
        paymentId: paymentEntity.id,
        orderId: paymentEntity.order_id || null,
        amount: paymentEntity.amount,
        currency: paymentEntity.currency,
        status: paymentEntity.status,
        method: paymentEntity.method || null,
        contact: paymentEntity.contact || paymentEntity.customer?.contact || null,
        email: paymentEntity.email || paymentEntity.customer?.email || null,
        cardNetwork: paymentEntity.card?.network || null,
        cardLast4: paymentEntity.card?.last4 || null,
        fee: paymentEntity.fee || null,
        tax: paymentEntity.tax || null,
      });

      if (!lead) {
        console.warn("Razorpay Webhook: Payment received but lead not found for ID/Phone. Logged to razorpayPayments anyway.");
        return res.status(200).send("OK");
      }

      if (lead.hasPaid) {
        console.warn(`Razorpay Webhook: Payment already processed for lead ${lead.id}. Ignoring duplicate webhook.`);
        return res.status(200).send("OK");
      }

      const paymentId = paymentEntity.id;
      
      await db.update(leads)
        .set({ hasPaid: true, paymentId: paymentId, updatedAt: new Date() })
        .where(eq(leads.id, lead.id));

      await db.insert(activityLogs).values({
        id: generateId(),
        leadId: lead.id,
        action: "PAYMENT_SUCCESSFUL",
        details: JSON.stringify({ paymentId, amount: paymentEntity.amount, event: payload.event })
      });

      await sendWhatsAppTemplate(lead.phone, "utl_clarity_payment_success", "en");
      
      if (lead.assessment) {
         await db.insert(messagesTable).values({
            id: generateId(),
            assessmentId: lead.assessment.id,
            role: "SYSTEM",
            content: "[System: Sent Payment Success Template]",
         });
      }

      try {
        const adminList = await db.select().from(admins).where(isNotNull(admins.phone));
        Promise.allSettled(adminList.map(admin => {
          if (admin.phone) {
            return sendWhatsAppTemplate(admin.phone, "utl_clarity_admin_notify", "en", [
              { type: "header", parameters: [{ type: "text", parameter_name: "name", text: "Admin" }] },
              { type: "body", parameters: [
                { type: "text", parameter_name: "username", text: lead.name || "User" },
                { type: "text", parameter_name: "userphonenumber", text: lead.phone }
              ]}
            ]);
          }
        })).catch(err => console.error("Failed to notify admins of payment", err));
      } catch(e) {
        console.error("Error fetching admins for payment notification", e);
      }

      console.log(`Successfully processed payment for ${lead.phone}`);
    } else if (payload.event === "payment.failed") {
      const paymentEntity = payload.payload.payment?.entity;
      
      const serviceFromNotes = paymentEntity?.notes?.service;
      if (serviceFromNotes !== "clarity app") {
        console.warn(`Razorpay Webhook: Ignored failed payment for different service (${serviceFromNotes || 'unknown'})`);
        return res.status(200).send("OK");
      }
      
      const exactLeadId = paymentEntity?.notes?.leadId || paymentEntity?.reference_id;
      let lead: any = null;

      if (exactLeadId) {
        lead = await db.query.leads.findFirst({
          where: eq(leads.id, exactLeadId),
          with: { assessment: true }
        });
      }

      if (!lead) {
        const rawPhone = paymentEntity?.contact || paymentEntity?.customer?.contact;
        if (rawPhone) {
          let formattedPhone = String(rawPhone).replace(/[^0-9]/g, "");
          const searchPhone = formattedPhone.length > 10 ? formattedPhone.slice(-10) : formattedPhone;
          
          lead = await db.query.leads.findFirst({
            where: ilike(leads.phone, `%${searchPhone}%`),
            with: { assessment: true }
          });
        }
      }

      if (lead) {
        await db.insert(activityLogs).values({
          id: generateId(),
          leadId: lead.id,
          action: "PAYMENT_FAILED",
          details: JSON.stringify({ paymentId: paymentEntity?.id, amount: paymentEntity?.amount, event: payload.event })
        });
        
        const paymentLinkUrl = lead.paymentLink || process.env.RAZORPAY_PAYMENT_LINK || "https://rzp.io/rzp/XW1Jd0p";
        
        const components = [
          { type: "header", parameters: [{ type: "text", parameter_name: "name", text: lead.name || "User" }] },
          { type: "body", parameters: [{ type: "text", parameter_name: "paymentlink", text: paymentLinkUrl }] }
        ];

        await sendWhatsAppTemplate(lead.phone, "utl_clarity_payment_failed", "en", components);
        console.log(`Successfully processed failed payment webhook for ${lead.phone}`);
      }
    }

    return res.status(200).send("OK");
  } catch (error) {
    console.error("Razorpay Webhook Error:", error);
    return res.status(500).send("Error");
  }
};
