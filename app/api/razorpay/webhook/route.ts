import { NextResponse } from "next/server";
import crypto from "crypto";
import { db, generateId } from "@/lib/db";
import { leads, activityLogs, messages as messagesTable, razorpayPayments } from "@/db/schema";
import { ilike, eq } from "drizzle-orm";
import { sendWhatsAppMessage, sendWhatsAppTemplate } from "@/lib/whatsapp";

const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || "default_secret";

export async function POST(req: Request) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get("x-razorpay-signature");

    if (!signature) {
      return new NextResponse("Missing Signature", { status: 400 });
    }

    // Verify webhook signature
    const expectedSignature = crypto
      .createHmac("sha256", RAZORPAY_WEBHOOK_SECRET)
      .update(rawBody)
      .digest("hex");

    if (expectedSignature !== signature) {
      console.error("Invalid Razorpay Webhook Signature");
      return new NextResponse("Invalid Signature", { status: 400 });
    }

    const payload = JSON.parse(rawBody);
    console.log("Full Razorpay Webhook Payload:", JSON.stringify(payload, null, 2));

    // We only care about payment success events
    if (payload.event === "payment.link.paid" || payload.event === "payment.captured") {
      const paymentEntity = payload.payload.payment?.entity || payload.payload.payment_link?.entity;
      const paymentLinkEntity = payload.payload.payment_link?.entity;
      
      // Ensure this payment belongs to the Clarity App
      const serviceFromNotes = paymentEntity?.notes?.service || paymentLinkEntity?.notes?.service;
      if (serviceFromNotes !== "clarity app") {
        console.warn(`Razorpay Webhook: Ignored payment for different service (${serviceFromNotes || 'unknown'})`);
        return new NextResponse("OK", { status: 200 });
      }
      
      // Extract the exact lead ID from notes or reference_id
      const leadIdFromNotes = paymentEntity?.notes?.leadId || paymentLinkEntity?.notes?.leadId;
      const leadIdFromReference = paymentEntity?.reference_id || paymentLinkEntity?.reference_id;
      const exactLeadId = leadIdFromNotes || leadIdFromReference;

      let lead = null;

      // Prioritize precise lookup by ID
      if (exactLeadId) {
        lead = await db.query.leads.findFirst({
          where: eq(leads.id, exactLeadId),
          with: { assessment: true }
        });
      }

      // Fallback to phone number if exact ID lookup fails (e.g., manual payment links)
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

      // Log the payment payload into the database instantly
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
        return new NextResponse("OK", { status: 200 });
      }

      // Idempotency Check: Don't process twice!
      if (lead.hasPaid) {
        console.warn(`Razorpay Webhook: Payment already processed for lead ${lead.id}. Ignoring duplicate webhook.`);
        return new NextResponse("OK", { status: 200 });
      }

      // Mark as paid
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
      
      // Log the message in the DB
      if (lead.assessment) {
         await db.insert(messagesTable).values({
            id: generateId(),
            assessmentId: lead.assessment.id,
            role: "SYSTEM",
            content: "[System: Sent Payment Success Template]",
         });
      }

      console.log(`Successfully processed payment for ${lead.phone}`);
    }

    return new NextResponse("OK", { status: 200 });
  } catch (error) {
    console.error("Razorpay Webhook Error:", error);
    return new NextResponse("Error", { status: 500 });
  }
}
