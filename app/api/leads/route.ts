import { NextResponse } from "next/server";
import { db, generateId } from "@/lib/db";
import { leads, assessments, activityLogs, admins } from "@/db/schema";
import { eq, isNotNull } from "drizzle-orm";
import { sendWhatsAppMessage, sendWhatsAppTemplate } from "@/lib/whatsapp";

export async function POST(req: Request) {
  try {
    const { name, phone } = await req.json();

    if (!name || !phone) {
      return NextResponse.json({ error: "Name and phone are required" }, { status: 400 });
    }

    // Format phone number
    const formattedPhone = phone.replace(/[^0-9]/g, "");

    // Check if lead already exists
    const existingLead = await db.query.leads.findFirst({
      where: eq(leads.phone, formattedPhone)
    });

    if (existingLead) {
      return NextResponse.json(
        { error: "Your phone number already exists in our system. Please contact us for assistance." },
        { status: 409 }
      );
    }

    // Create lead, assessment, and initial telemetry in DB
    const leadId = generateId();
    const [lead] = await db.insert(leads).values({
      id: leadId,
      name,
      phone: formattedPhone,
      updatedAt: new Date(),
    }).returning();

    const assessmentId = generateId();
    await db.insert(assessments).values({
      id: assessmentId,
      leadId: lead.id,
      status: "PENDING",
      currentQuestion: 0,
      updatedAt: new Date(),
    });

    await db.insert(activityLogs).values({
      id: generateId(),
      leadId: lead.id,
      action: "LEAD_CREATED",
      details: JSON.stringify({ name, phone: formattedPhone, source: "WEB_FORM" })
    });

    // Send the first welcome message via WhatsApp
    const welcomeText = `Hi ${name}! Thanks for joining our waitlist. Are you ready to start your quick 3-question AI assessment? Reply *YES* to begin.`;
    
    await sendWhatsAppTemplate(formattedPhone, "utl_clarity_greeting_msg", "en", [
      {
        type: "header",
        parameters: [
          { type: "text", parameter_name: "name", text: name }
        ]
      }
    ]);

    // Save the system message to the DB
    const { messages } = await import("@/db/schema");
    await db.insert(messages).values({
      id: generateId(),
      assessmentId: assessmentId,
      role: "SYSTEM",
      content: welcomeText,
    });

    // Notify all admins via WhatsApp Template (non-blocking)
    try {
      const adminList = await db.select().from(admins).where(isNotNull(admins.phone));
      Promise.allSettled(adminList.map(admin => {
        if (admin.phone) {
          return sendWhatsAppTemplate(admin.phone, "utl_clarity_admin_notify", "en", [
            {
              type: "header",
              parameters: [
                { type: "text", parameter_name: "name", text: "Admin" }
              ]
            }
          ]);
        }
      })).catch(err => console.error("Failed to notify admins", err));
    } catch(e) {
      console.error("Error fetching admins for notification", e);
    }

    return NextResponse.json({ success: true, lead });
  } catch (error: any) {
    console.error("Lead Creation Error:", error);
    return NextResponse.json({ error: "Failed to create lead" }, { status: 500 });
  }
}
