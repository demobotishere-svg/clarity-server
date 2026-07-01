import { Request, Response } from "express";
import { db } from "../lib/db";
import { admins } from "../db/schema";
import { eq } from "drizzle-orm";
import { SignJWT } from "jose";

const getJwtSecretKey = () => {
  const secret = process.env.JWT_SECRET || "fallback_secret_key_change_me";
  return new TextEncoder().encode(secret);
};

export const setupAdmin = async (req: Request, res: Response) => {
  try {
    const admin = (req as any).admin;
    if (!admin) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const phone = req.body.phone;

    if (!phone || typeof phone !== "string" || phone.length < 10) {
      return res.status(400).json({ error: "Invalid phone number" });
    }

    await db.update(admins).set({ phone }).where(eq(admins.id, admin.id));

    const newToken = await new SignJWT({ 
      id: admin.id, 
      email: admin.email,
      hasPhone: true 
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("24h")
      .sign(getJwtSecretKey());

    res.cookie("admin_token", newToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 1000,
      path: "/",
    });

    return res.json({ success: true });

  } catch (error) {
    console.error("Setup API Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};
