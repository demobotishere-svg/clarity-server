import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

export const verifyWhatsAppSignature = (req: Request, res: Response, next: NextFunction) => {
  const signature = req.headers["x-hub-signature-256"] as string;

  if (!signature) {
    console.warn("WhatsApp Webhook: Missing X-Hub-Signature-256 header.");
    return res.status(401).send("Missing signature");
  }

  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) {
    console.warn("WhatsApp Webhook: WHATSAPP_APP_SECRET is not configured.");
    return res.status(500).send("Server configuration error");
  }

  const rawBody = (req as any).rawBody;
  if (!rawBody) {
    console.warn("WhatsApp Webhook: req.rawBody is missing. Ensure express.json() is configured correctly.");
    return res.status(500).send("Internal Server Error");
  }

  const expectedSignature = "sha256=" + crypto.createHmac("sha256", appSecret).update(rawBody, "utf-8").digest("hex");

  if (signature !== expectedSignature) {
    console.warn("WhatsApp Webhook: Invalid signature detected. Possible spoofing attempt.");
    return res.status(401).send("Invalid signature");
  }

  next();
};
