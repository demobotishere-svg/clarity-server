import { NextResponse } from "next/server";
import crypto from "crypto";
import { db, generateId } from "@/lib/db";
import { leads, assessments, activityLogs, messages as messagesTable, processedWebhooks, pendingMessages, admins } from "@/db/schema";
import { eq, desc, and, isNotNull } from "drizzle-orm";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { generateAssessmentReport, validateAnswer } from "@/lib/gemini";

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const APP_SECRET = process.env.WHATSAPP_APP_SECRET || "default_secret";

const QUESTIONS = [
  "1. To help us understand your requirements, what is the main outcome you're hoping to achieve with AI?",
  "2. Which task takes up the most time in your daily workflow and would you like to make more efficient?",
  "3. To help us identify the most suitable solution, what results would you like to achieve within the next 3 months?",
];

// Verify token for Meta webhook setup
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 });
  } else {
    return new NextResponse("Forbidden", { status: 403 });
  }
}

export async function POST(req: Request) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get("x-hub-signature-256");

    // Skip signature check in local dev without an app secret, or enforce it in prod
    if (process.env.NODE_ENV === "production" && !signature) {
      console.warn("Missing x-hub-signature-256 header");
      return new NextResponse("Unauthorized", { status: 401 });
    }

    if (signature) {
      const expectedSignature = "sha256=" + crypto
        .createHmac("sha256", APP_SECRET)
        .update(rawBody)
        .digest("hex");

      if (expectedSignature !== signature) {
        console.error("Invalid Webhook Signature.");
        return new NextResponse("Unauthorized", { status: 401 });
      }
    }

    const body = JSON.parse(rawBody);

    if (body.object !== "whatsapp_business_account") {
      return new NextResponse("Not Found", { status: 404 });
    }

    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const statuses = value?.statuses;

    // Process Delivery Status Updates
    if (statuses && statuses.length > 0) {
      console.log(`[Webhook] Received ${statuses.length} status updates:`, JSON.stringify(statuses));
      for (const statusObj of statuses) {
        const wamid = statusObj.id;
        const statusType = statusObj.status; // 'sent', 'delivered', 'read', 'failed'
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
      return new NextResponse("OK", { status: 200 });
    }

    const messages = value?.messages;

    if (!messages || messages.length === 0) {
      return new NextResponse("OK", { status: 200 });
    }

    const message = messages[0];
    const phone = message.from;
    let text = message.text?.body || "";

    // Parse interactive button replies
    if (message.type === "interactive" && message.interactive?.type === "button_reply") {
      text = message.interactive.button_reply.title || message.interactive.button_reply.id || "";
    } else if (message.type === "button") {
      text = message.button?.text || message.button?.payload || "";
    }

    if (!text) {
      return new NextResponse("OK", { status: 200 });
    }

    // Idempotency Check
    const messageId = message.id;
    if (messageId) {
      const existing = await db.select().from(processedWebhooks).where(eq(processedWebhooks.messageId, messageId));
      if (existing.length > 0) {
        console.warn(`[Webhook] Duplicate Meta Webhook ID detected: ${messageId}. Dropping safely.`);
        return new NextResponse("OK", { status: 200 });
      }
      await db.insert(processedWebhooks).values({ id: generateId(), messageId });
    }

    // Rate Limiting (Abuse Prevention)
    const { checkRateLimit } = await import("@/lib/rateLimit");
    const allowed = await checkRateLimit(phone, "whatsapp_webhook", 100, 60); // 100 msgs per hour max
    if (!allowed) {
      console.warn(`[Webhook] Rate limit exceeded for phone ${phone}`);
      return new NextResponse("Rate limit exceeded", { status: 429 });
    }

    // 1. Input Sanitization (Security & Cost Control)
    // Strip HTML/Scripts tags to ensure pure text
    text = text.replace(/<[^>]*>?/gm, '').trim();

    if (text.length > 500) {
      console.warn(`[Webhook] Dropping oversized message from ${phone} (${text.length} chars)`);
      // Optional: Inform the user
      const { sendWhatsAppMessage } = await import("@/lib/whatsapp");
      await sendWhatsAppMessage(phone, "Your message is too long. Please keep your answers under 500 characters!");
      return new NextResponse("Message too long", { status: 400 });
    }

    // Get profile name from contacts payload
    const profileName = value?.contacts?.[0]?.profile?.name || "WhatsApp User";

    // Get the base URL from the request for PDF public link
    const host = req.headers.get("host") || "localhost:3000";
    const protocol = req.headers.get("x-forwarded-proto") || "https";
    const baseUrl = `${protocol}://${host}`;

    // Process the message
    await handleIncomingMessage(phone, text, baseUrl, profileName);

    return new NextResponse("OK", { status: 200 });
  } catch (error) {
    console.error("Webhook Error:", error);
    return new NextResponse("Error", { status: 500 });
  }
}

async function handleIncomingMessage(phone: string, text: string, baseUrl: string, profileName: string) {
  // Find the lead and active assessment
  let lead = await db.query.leads.findFirst({
    where: eq(leads.phone, phone),
    with: { assessment: true },
  });

  if (!lead || !lead.assessment) {
    console.log(`[Webhook] Unrecognized phone ${phone}. Auto-creating lead using profile name: ${profileName}`);
    
    // Auto-create lead
    const leadId = generateId();
    const [newLead] = await db.insert(leads).values({
      id: leadId,
      name: profileName,
      phone: phone,
      updatedAt: new Date(),
    }).returning();

    // Auto-create assessment directly to IN_PROGRESS
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

    // Save their initial message
    await db.insert(messagesTable).values({
      id: generateId(),
      assessmentId: newAssessment.id,
      role: "USER",
      content: text,
    });

    // Send Welcome and First Question
    await sendSystemMessage(phone, newAssessment.id, `Hi ${profileName}! Welcome to the Clarity Assessment. Let's get started!`);
    await sendSystemMessage(phone, newAssessment.id, QUESTIONS[0]);

    // Notify Admins
    try {
      const { sendWhatsAppTemplate } = await import("@/lib/whatsapp");
      const adminList = await db.select().from(admins).where(isNotNull(admins.phone));
      Promise.allSettled(adminList.map(admin => {
        if (admin.phone) {
          return sendWhatsAppTemplate(admin.phone, "utl_clarity_admin_notify", "en", [
            { type: "header", parameters: [{ type: "text", parameter_name: "name", text: "Admin" }] }
          ]);
        }
      })).catch(err => console.error("Failed to notify admins", err));
    } catch(e) {
      console.error("Error fetching admins for notification", e);
    }

    return; // Stop processing since they just got question 1
  }

  // Log raw webhook reception
  await db.insert(activityLogs).values({
    id: generateId(),
    leadId: lead.id,
    action: "WEBHOOK_RECEIVED",
    details: JSON.stringify({ messageType: "text", length: text.length })
  });

  const assessment = lead.assessment;

  if (assessment.status === "COMPLETED") {
    await sendWhatsAppMessage(phone, "Your assessment is already complete. We will be in touch soon!");
    return;
  }

  // Prevent duplicate concurrent message processing
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
    
    // Exact duplicate drop (prevent double webhooks)
    if (lastMsg.content === text && timeDiff < 3000) {
      console.warn(`[Webhook] Duplicate concurrent message detected from ${phone}, ignoring.`);
      return;
    }

    // 2. Strict Rate Limiting (Spam Control)
    // Check if the user has sent 5 messages in the last 60 seconds
    if (recentMessages.length === 5) {
      const fifthMsgTime = new Date(recentMessages[4].createdAt).getTime();
      const timeSinceFifthMsg = Date.now() - fifthMsgTime;
      
      if (timeSinceFifthMsg < 60000) { // 60 seconds
        console.warn(`[Webhook] Rate limit exceeded for ${phone}. Dropping message.`);
        await sendWhatsAppMessage(phone, "You are sending messages too quickly. Please wait a moment and try again.");
        return;
      }
    }
  }

  // Save the user's message
  const [userMessage] = await db.insert(messagesTable).values({
    id: generateId(),
    assessmentId: assessment.id,
    role: "USER",
    content: text,
  }).returning();

  const userSaidYes = text.trim().toLowerCase() === "yes" || text.toLowerCase().includes("start assessment") || text.toLowerCase().includes("take the assessment");

  if (assessment.status === "PENDING") {
    if (userSaidYes) {
      // Start the assessment
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
    const currentQIdx = assessment.currentQuestion; // 1-indexed
    const currentQuestionText = QUESTIONS[currentQIdx - 1];

    if (userSaidYes) {
      await sendSystemMessage(phone, assessment.id, "It looks like you're ready to continue! Let's get back to it:\n\n" + currentQuestionText);
      return;
    }

    // Real-time AI validation
    console.log(`[Webhook] Validating answer for Q${currentQIdx}: "${text}"`);
    const validation = await validateAnswer(currentQuestionText, text);
    console.log(`[Webhook] Validation Result:`, validation);

    // Update message acceptability in the database
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
      return; // DO NOT increment question, wait for a valid answer
    }

    console.log(`[Webhook] Answer valid! Advancing from Q${currentQIdx} to Q${currentQIdx + 1}`);
    if (currentQIdx < QUESTIONS.length) {
      // Ask the next question
      await db.update(assessments)
        .set({ currentQuestion: currentQIdx + 1, updatedAt: new Date() })
        .where(eq(assessments.id, assessment.id));
      await sendSystemMessage(phone, assessment.id, QUESTIONS[currentQIdx]);
    } else {
      // Last question answered! Generate Report
      await db.update(assessments)
        .set({ status: "COMPLETED", updatedAt: new Date() })
        .where(eq(assessments.id, assessment.id));

      await sendSystemMessage(phone, assessment.id, "Thank you! Generating your AI report now... Please wait a moment. ⏳");

      // Fetch all Q&A pairs
      const allMessages = await db.query.messages.findMany({
        where: eq(messagesTable.assessmentId, assessment.id),
        orderBy: (messagesTable, { asc }) => [asc(messagesTable.createdAt)],
      });

      // Extract strictly the final valid answers for the 3 official questions
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

      // Generate Report using Gemini
      const { score, summary, profession, reportMarkdown } = await generateAssessmentReport(qaPairs, lead.name);

      // Generate dynamic Razorpay Payment Link
      let paymentLinkUrl = process.env.RAZORPAY_PAYMENT_LINK || 'https://rzp.io/l/demo';

      if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
        try {
          const Razorpay = (await import("razorpay")).default;
          const razorpay = new Razorpay({
            key_id: process.env.RAZORPAY_KEY_ID,
            key_secret: process.env.RAZORPAY_KEY_SECRET,
          });
          console.log("name", lead.name, "phone", lead.phone);
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
              //console log of phone number
            },
            notify: {
              sms: false,
              email: false
            },
            reminder_enable: false,
          });

          if (paymentLink.short_url) {
            paymentLinkUrl = paymentLink.short_url;
          }
        } catch (error) {
          console.error("Failed to generate dynamic Razorpay link:", error);
        }
      }

      // Generate PDF with a unique timestamp to prevent caching
      const { generateReportPDF } = await import("@/lib/pdf");
      const uniqueId = `${assessment.id}_${Date.now()}`;
      const pdfFileName = await generateReportPDF(uniqueId, lead.name, qaPairs, reportMarkdown, score, paymentLinkUrl);
      const pdfUrl = `${baseUrl}/reports/${pdfFileName}`;

      // Update DB with score, report markdown, pdfUrl, summary, and profession
      await db.update(assessments)
        .set({
          score: score,
          summary: summary,
          profession: profession,
          report: reportMarkdown,
          pdfUrl: pdfUrl,
          updatedAt: new Date()
        })
        .where(eq(assessments.id, assessment.id));

      await db.insert(activityLogs).values({
        id: generateId(),
        leadId: lead.id,
        action: "REPORT_GENERATED",
        details: JSON.stringify({ score, pdfGenerated: true })
      });

      // Send the text summary
      await sendSystemMessage(phone, assessment.id, `*Assessment Complete!*\n\nWe have analyzed your inputs. You scored an AI Readiness Rating of *${score}/100*.\n\nPlease find your detailed strategic analysis and personalized recommendations in the PDF below.\n\nReady to scale your business? *Join Clarity Now:* ${paymentLinkUrl}`);

      // Send the PDF Document
      const { sendWhatsAppDocument } = await import("@/lib/whatsapp");
      await sendWhatsAppDocument(phone, pdfUrl, `${lead.name}_Analysis.pdf`, "Your AI Strategy Report");

      await db.insert(activityLogs).values({
        id: generateId(),
        leadId: lead.id,
        action: "PDF_SENT_TO_WHATSAPP",
        details: JSON.stringify({ success: true })
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
