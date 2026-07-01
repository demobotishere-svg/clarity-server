import { Request, Response } from "express";
import { db, generateId } from "../lib/db";
import { bulkBatches, pendingMessages, leads } from "../db/schema";
import { jwtVerify } from "jose";
import { inArray } from "drizzle-orm";

const getJwtSecretKey = () => {
  const secret = process.env.JWT_SECRET || "fallback_secret_key_change_me";
  return new TextEncoder().encode(secret);
};

export const queueBulkMessages = async (req: Request, res: Response) => {
  try {
    const token = req.cookies.admin_token;
    if (!token) return res.status(401).send("Unauthorized");

    const { payload } = await jwtVerify(token, getJwtSecretKey());
    const adminId = payload.id as string;

    const { leadIds, templateName } = req.body;

    if (!Array.isArray(leadIds) || leadIds.length === 0 || !templateName) {
      return res.status(400).send("Invalid payload");
    }

    const validLeads = await db.select({ id: leads.id }).from(leads).where(inArray(leads.id, leadIds));
    const validLeadIds = validLeads.map(l => l.id);

    if (validLeadIds.length === 0) {
      return res.status(400).send("No valid leads provided");
    }

    const batchId = generateId();

    await db.insert(bulkBatches).values({
      id: batchId,
      adminId,
      templateName,
      totalCount: validLeadIds.length,
    });

    const queueEntries = validLeadIds.map(leadId => ({
      id: generateId(),
      batchId,
      leadId,
      templateName,
    }));

    await db.insert(pendingMessages).values(queueEntries);

    // Auto-trigger cron
    const protocol = req.headers["x-forwarded-proto"] || req.protocol;
    const host = req.headers.host;
    fetch(`${protocol}://${host}/api/cron/process-queue`, {
      headers: {
        "Authorization": `Bearer ${process.env.CRON_SECRET || ""}`
      }
    }).catch(err => console.error("Auto-process trigger failed:", err));

    return res.json({ success: true, batchId, queuedCount: validLeadIds.length });
  } catch (error) {
    console.error("Bulk Queue Error:", error);
    return res.status(500).send("Internal Server Error");
  }
};
