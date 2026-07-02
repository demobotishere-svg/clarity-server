import { Request, Response } from "express";
import crypto from "crypto";
import { db, generateId } from "../lib/db";
import { leads, assessments, activityLogs, messages as messagesTable, processedWebhooks, pendingMessages, admins } from "../db/schema";
import { eq, desc, and, isNotNull } from "drizzle-orm";
import { sendWhatsAppMessage } from "../lib/whatsapp";
import { generateAssessmentReport, validateAnswer } from "../lib/gemini";
import { checkRateLimit } from "../lib/rateLimit";
import pLimit from "p-limit";

const userQueues = new Map<string, any>();

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const APP_SECRET = process.env.WHATSAPP_APP_SECRET;

if (!APP_SECRET) {
  console.warn("CRITICAL: WHATSAPP_APP_SECRET is not set. Webhook signatures will fail.");
}

const QUESTIONS = [
  "1. To help us understand your requirements, what is the main outcome you're hoping to achieve with AI?",
  "2. Which task takes up the most time in your daily workflow and would you like to make more efficient?",
  "3. To help us identify the most suitable solution, what results would you like to achieve within the next 3 months?",
];

export const verifyWebhook = async (req: Request, res: Response) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  } else {
    return res.status(403).send("Forbidden");
  }
};

export const handleWebhook = async (req: Request, res: Response) => {
  try {
    const rawBody = (req as any).rawBody || JSON.stringify(req.body);
    const signature = req.headers["x-hub-signature-256"] as string;

    if (process.env.NODE_ENV === "production" && !signature) {
      console.warn("Missing x-hub-signature-256 header");
      return res.status(401).send("Unauthorized");
    }

    if (signature) {
      if (!APP_SECRET) {
        return res.status(500).send("Server Configuration Error");
      }
      const expectedSignature = "sha256=" + crypto
        .createHmac("sha256", APP_SECRET)
        .update(rawBody)
        .digest("hex");

      if (expectedSignature !== signature) {
        console.error("Invalid Webhook Signature.");
        return res.status(401).send("Unauthorized");
      }
    }

    const body = req.body;

    if (body.object !== "whatsapp_business_account") {
      return res.status(404).send("Not Found");
    }

    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const statuses = value?.statuses;

    if (statuses && statuses.length > 0) {
      console.log(`[Webhook] Received ${statuses.length} status updates:`, JSON.stringify(statuses));
      for (const statusObj of statuses) {
        const wamid = statusObj.id;
        const statusType = statusObj.status;
        const mappedStatus = statusType.toUpperCase();
        
        if (['SENT', 'DELIVERED', 'READ', 'FAILED'].includes(mappedStatus)) {
          let errorReason = "";
          if (mappedStatus === 'FAILED' && statusObj.errors && statusObj.errors.length > 0) {
             errorReason = statusObj.errors[0].title || statusObj.errors[0].message || "Unknown Meta API error";
          }
          
          const updateData: any = { status: mappedStatus };
          if (errorReason) updateData.errorReason = errorReason;
          
          await db.update(pendingMessages)
            .set(updateData)
            .where(eq(pendingMessages.messageId, wamid));
        }
      }
      return res.status(200).send("OK");
    }

    const messages = value?.messages;

    if (!messages || messages.length === 0) {
      return res.status(200).send("OK");
    }

    const message = messages[0];
    const phone = message.from;
    let text = message.text?.body || "";

    if (message.type === "interactive" && message.interactive?.type === "button_reply") {
      text = message.interactive.button_reply.title || message.interactive.button_reply.id || "";
    } else if (message.type === "button") {
      text = message.button?.text || message.button?.payload || "";
    }

    if (!text) {
      return res.status(200).send("OK");
    }

    const messageId = message.id;
    if (messageId) {
      const existing = await db.select().from(processedWebhooks).where(eq(processedWebhooks.messageId, messageId));
      if (existing.length > 0) {
        console.warn(`[Webhook] Duplicate Meta Webhook ID detected: ${messageId}. Dropping safely.`);
        return res.status(200).send("OK");
      }
      await db.insert(processedWebhooks).values({ id: generateId(), messageId });
    }

    const allowed = await checkRateLimit(phone, "whatsapp_webhook", 100, 60);
    if (!allowed) {
      console.warn(`[Webhook] Rate limit exceeded for phone ${phone}`);
      return res.status(429).send("Rate limit exceeded");
    }

    text = text.replace(/<[^>]*>?/gm, '').trim();

    if (text.length > 500) {
      console.warn(`[Webhook] Dropping oversized message from ${phone} (${text.length} chars)`);
      const { sendWhatsAppMessage } = await import("../lib/whatsapp");
      await sendWhatsAppMessage(phone, "Your message is too long. Please keep your answers under 500 characters!");
      return res.status(400).send("Message too long");
    }

    let profileName = value?.contacts?.[0]?.profile?.name || "WhatsApp User";
    // Sanitize profileName (strip HTML tags)
    profileName = profileName.replace(/<[^>]*>?/gm, '').trim();
    const host = req.headers.host || "localhost:3000";
    const protocol = req.headers["x-forwarded-proto"] || "https";
    const baseUrl = `${protocol}://${host}`;

    // Acknowledge immediately to prevent Meta Webhook timeouts
    res.status(200).send("OK");

    // Get or create queue for this user
    if (!userQueues.has(phone)) {
      userQueues.set(phone, pLimit(1));
    }
    const userQueue = userQueues.get(phone);

    // Process asynchronously through their personal queue
    userQueue(async () => {
      try {
        await handleIncomingMessage(phone, text, baseUrl, profileName);
      } catch (error) {
        console.error(`Async Incoming Message Error for ${phone}:`, error);
      }
    });
  } catch (error: any) {
    console.error("Webhook Error:", error);
    return res.status(500).send(`Error: ${error.stack || error.message || String(error)}`);
  }
};

async function handleIncomingMessage(phone: string, text: string, baseUrl: string, profileName: string) {
  let lead = await db.query.leads.findFirst({
    where: (leads, { eq, or }) => or(
      eq(leads.phone, phone),
      phone.startsWith("91") ? eq(leads.phone, phone.substring(2)) : undefined
    ),
    with: { assessment: true },
  });

  if (!lead || !lead.assessment) {
    console.log(`[Webhook] Unrecognized phone ${phone}. Auto-creating lead using profile name: ${profileName}`);
    
    const leadId = generateId();
    const [newLead] = await db.insert(leads).values({
      id: leadId,
      name: profileName,
      phone: phone,
      updatedAt: new Date(),
    }).returning();

    const assessmentId = generateId();
    const [newAssessment] = await db.insert(assessments).values({
      id: assessmentId,
      leadId: newLead.id,
      status: "IN_PROGRESS",
      currentQuestion: 1,
      updatedAt: new Date(),
    }).returning();

    lead = { ...newLead, assessment: newAssessment } as any;

    await db.insert(activityLogs).values({
      id: generateId(),
      leadId: newLead.id,
      action: "LEAD_CREATED_VIA_WHATSAPP",
      details: JSON.stringify({ name: profileName, phone })
    });

    await db.insert(messagesTable).values({
      id: generateId(),
      assessmentId: newAssessment.id,
      role: "USER",
      content: text,
    });

    await sendSystemMessage(phone, newAssessment.id, `Hi ${profileName}! Welcome to the Clarity Assessment. Let's get started!`);
    await sendSystemMessage(phone, newAssessment.id, QUESTIONS[0]);



    return;
  }

  await db.insert(activityLogs).values({
    id: generateId(),
    leadId: lead.id,
    action: "WEBHOOK_RECEIVED",
    details: JSON.stringify({ messageType: "text", length: text.length })
  });

  const { sendWhatsAppMessage } = await import("../lib/whatsapp");

  if (text.trim().toUpperCase() === "STOP") {
    await db.update(leads).set({ isSubscribed: false }).where(eq(leads.id, lead.id));
    await sendWhatsAppMessage(phone, "You have been successfully unsubscribed. You will no longer receive automated messages from us.");
    return;
  }

  // If they were unsubscribed but sent a regular message, opt them back in
  if (lead.isSubscribed === false) {
    await db.update(leads).set({ isSubscribed: true }).where(eq(leads.id, lead.id));
  }

  const assessment = lead.assessment;

  if (assessment.status === "COMPLETED") {
    await sendWhatsAppMessage(phone, "Your assessment is already complete. We will be in touch soon!");
    return;
  }

  const recentMessages = await db.query.messages.findMany({
    where: and(
      eq(messagesTable.assessmentId, assessment.id),
      eq(messagesTable.role, "USER")
    ),
    orderBy: [desc(messagesTable.createdAt)],
    limit: 5,
  });

  if (recentMessages.length > 0) {
    const lastMsg = recentMessages[0];
    const timeDiff = Math.abs(Date.now() - new Date(lastMsg.createdAt).getTime());
    
    if (lastMsg.content === text && timeDiff < 3000) {
      console.warn(`[Webhook] Duplicate concurrent message detected from ${phone}, ignoring.`);
      return;
    }

    if (recentMessages.length === 5) {
      const fifthMsgTime = new Date(recentMessages[4].createdAt).getTime();
      const timeSinceFifthMsg = Date.now() - fifthMsgTime;
      
      if (timeSinceFifthMsg >= 0 && timeSinceFifthMsg < 60000) {
        console.warn(`[Webhook] Rate limit exceeded for ${phone}. Dropping message.`);
        await sendWhatsAppMessage(phone, "You are sending messages too quickly. Please wait a moment and try again.");
        return;
      }
    }
  }

  const [userMessage] = await db.insert(messagesTable).values({
    id: generateId(),
    assessmentId: assessment.id,
    role: "USER",
    content: text,
  }).returning();

  const userSaidYes = text.trim().toLowerCase() === "yes" || text.toLowerCase().includes("start assessment") || text.toLowerCase().includes("take the assessment");

  if (assessment.status === "PENDING") {
    if (userSaidYes) {
      await db.update(assessments)
        .set({ status: "IN_PROGRESS", currentQuestion: 1, updatedAt: new Date() })
        .where(eq(assessments.id, assessment.id));

      await db.insert(activityLogs).values({
        id: generateId(),
        leadId: lead.id,
        action: "ASSESSMENT_STARTED",
        details: "User initiated assessment"
      });
      await sendSystemMessage(phone, assessment.id, QUESTIONS[0]);

    } else {
      await sendSystemMessage(phone, assessment.id, "Please reply *YES* when you are ready to begin.");
    }
    return;
  }

  if (assessment.status === "IN_PROGRESS") {
    const currentQIdx = assessment.currentQuestion;
    const currentQuestionText = QUESTIONS[currentQIdx - 1];

    if (userSaidYes) {
      await sendSystemMessage(phone, assessment.id, "It looks like you're ready to continue! Let's get back to it:\n\n" + currentQuestionText);
      return;
    }

    console.log(`[Webhook] Validating answer for Q${currentQIdx}: "${text}"`);
    const validation = await validateAnswer(currentQuestionText, text);
    console.log(`[Webhook] Validation Result:`, validation);

    await db.update(messagesTable)
      .set({ isAcceptable: validation.isValid })
      .where(eq(messagesTable.id, userMessage.id));

    await db.insert(activityLogs).values({
      id: generateId(),
      leadId: lead.id,
      action: validation.isValid ? "ANSWER_VALIDATION_SUCCESS" : "ANSWER_VALIDATION_FAILED",
      details: JSON.stringify({ questionId: currentQIdx, isValid: validation.isValid, feedback: validation.feedback || "None" })
    });

    if (!validation.isValid) {
      if (validation.feedback) {
        console.log(`[Webhook] Invalid answer, sending feedback: ${validation.feedback}`);
        await sendSystemMessage(phone, assessment.id, validation.feedback);
      } else {
        console.log(`[Webhook] Invalid answer but NO feedback generated! Falling back to generic feedback.`);
        await sendSystemMessage(phone, assessment.id, "I didn't quite catch that. Could you please try answering the question again?");
      }
      return;
    }

    console.log(`[Webhook] Answer valid! Advancing from Q${currentQIdx} to Q${currentQIdx + 1}`);
    if (currentQIdx < QUESTIONS.length) {
      await db.update(assessments)
        .set({ currentQuestion: currentQIdx + 1, updatedAt: new Date() })
        .where(eq(assessments.id, assessment.id));
      await sendSystemMessage(phone, assessment.id, QUESTIONS[currentQIdx]);
    } else {
      await db.update(assessments)
        .set({ status: "COMPLETED", updatedAt: new Date() })
        .where(eq(assessments.id, assessment.id));

      await sendSystemMessage(phone, assessment.id, "Thank you! Generating your AI report now... Please wait a moment. ⏳");

      const allMessages = await db.query.messages.findMany({
        where: eq(messagesTable.assessmentId, assessment.id),
        orderBy: (messagesTable, { asc }) => [asc(messagesTable.createdAt)],
      });

      const qaPairs = [];
      const markers = [
        QUESTIONS[1],
        QUESTIONS[2],
        "Thank you! Generating your AI report now... Please wait a moment. ⏳"
      ];

      for (let i = 0; i < QUESTIONS.length; i++) {
        const markerMsgIndex = allMessages.findIndex(m => m.role === "SYSTEM" && m.content === markers[i]);
        if (markerMsgIndex !== -1) {
          const answerMessages = allMessages.slice(0, markerMsgIndex).filter(m => m.role === "USER");
          if (answerMessages.length > 0) {
            qaPairs.push({
              question: QUESTIONS[i],
              answer: answerMessages[answerMessages.length - 1].content
            });
          }
        }
      }

      const { score, summary, profession, reportMarkdown } = await generateAssessmentReport(qaPairs, lead.name);

      let paymentLinkUrl = process.env.RAZORPAY_PAYMENT_LINK || 'https://rzp.io/l/demo';

      if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
        try {
          const Razorpay = (await import("razorpay")).default;
          const razorpay = new Razorpay({
            key_id: process.env.RAZORPAY_KEY_ID,
            key_secret: process.env.RAZORPAY_KEY_SECRET,
          });
          const paymentLink = await razorpay.paymentLink.create({
            notes: { service: "clarity app", leadId: lead.id },
            reference_id: lead.id,
            amount: 500000,
            currency: "INR",
            accept_partial: false,
            description: "Clarity Masterclass Access",
            customer: {
              name: lead.name,
              contact: lead.phone,
            },
            notify: {
              sms: false,
              email: false
            },
            reminder_enable: false,
          });

          if (paymentLink.short_url) {
            paymentLinkUrl = paymentLink.short_url;
            await db.update(leads).set({ paymentLink: paymentLinkUrl }).where(eq(leads.id, lead.id));
          }
        } catch (error) {
          console.error("Failed to generate dynamic Razorpay link:", error);
        }
      }

      await db.update(assessments)
        .set({
          score: score,
          summary: summary,
          profession: profession,
          report: reportMarkdown,
          updatedAt: new Date()
        })
        .where(eq(assessments.id, assessment.id));

      // Push to BullMQ for PDF Generation
      const { pdfQueue } = await import("../queues/queue");
      const uniqueId = `${assessment.id}_${Date.now()}`;
      await pdfQueue.add("generate-pdf", {
        uniqueId,
        leadName: lead.name,
        qaPairs,
        reportMarkdown,
        score,
        paymentLinkUrl,
        baseUrl,
        phone,
        assessmentId: assessment.id,
        leadId: lead.id
      });
    }
  }
}

async function sendSystemMessage(phone: string, assessmentId: string, text: string) {
  await sendWhatsAppMessage(phone, text);
  await db.insert(messagesTable).values({
    id: generateId(),
    assessmentId,
    role: "SYSTEM",
    content: text,
  });
}
