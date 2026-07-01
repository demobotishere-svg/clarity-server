import { Request, Response } from "express";
import { db, generateId } from "../lib/db";
import { leads, assessments, activityLogs, admins, messages as messagesTable } from "../db/schema";
import { eq, isNotNull } from "drizzle-orm";
import { sendWhatsAppTemplate } from "../lib/whatsapp";

export const createLead = async (req: Request, res: Response) => {
  try {
    const { name, phone } = req.body;

    if (!name || !phone) {
      return res.status(400).json({ error: "Name and phone are required" });
    }

    if (name.trim().length < 2 || name.trim().length > 50) {
      return res.status(400).json({ error: "Please enter a valid name (2-50 characters)" });
    }

    let formattedPhone = phone.replace(/[^0-9]/g, "");
    
    if (formattedPhone.length === 10) {
      formattedPhone = "91" + formattedPhone;
    } else if (formattedPhone.length < 10 || formattedPhone.length > 15) {
      return res.status(400).json({ error: "Please enter a valid phone number" });
    }

    const existingLead = await db.query.leads.findFirst({
      where: eq(leads.phone, formattedPhone)
    });

    if (existingLead) {
      return res.status(409).json({ error: "Your phone number already exists in our system. Please contact us for assistance." });
    }

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

    const welcomeText = `Hi ${name}! Thanks for joining our waitlist. Are you ready to start your quick 3-question AI assessment? Reply *YES* to begin.`;
    
    await sendWhatsAppTemplate(formattedPhone, "utl_clarity_greeting_msg", "en", [
      {
        type: "header",
        parameters: [
          { type: "text", parameter_name: "name", text: name }
        ]
      }
    ]);

    await db.insert(messagesTable).values({
      id: generateId(),
      assessmentId: assessmentId,
      role: "SYSTEM",
      content: welcomeText,
    });

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
            },
            {
              type: "body",
              parameters: [
                { type: "text", parameter_name: "username", text: name || "User" },
                { type: "text", parameter_name: "userphonenumber", text: formattedPhone }
              ]
            }
          ]);
        }
      })).catch(err => console.error("Failed to notify admins", err));
    } catch(e) {
      console.error("Error fetching admins for notification", e);
    }

    return res.json({ success: true, lead });
  } catch (error: any) {
    console.error("Lead Creation Error:", error);
    return res.status(500).json({ error: "Failed to create lead" });
  }
};
