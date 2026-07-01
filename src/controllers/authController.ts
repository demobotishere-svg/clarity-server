import { Request, Response } from "express";
import { db, generateId } from "../lib/db";
import { admins } from "../db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import { loginSchema, registerSchema } from "../lib/validations";
import { z } from "zod";

const getJwtSecretKey = () => {
  const secret = process.env.JWT_SECRET || "fallback_secret_key_change_me";
  return new TextEncoder().encode(secret);
};

export const login = async (req: Request, res: Response) => {
  try {
    const validation = loginSchema.safeParse(req.body);
    
    if (!validation.success) {
      return res.status(400).json({ error: validation.error.issues[0].message });
    }

    const { email, password } = validation.data;

    const adminResults = await db.select().from(admins).where(eq(admins.email, email));
    if (!adminResults || adminResults.length === 0) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const admin = adminResults[0];

    const passwordMatch = await bcrypt.compare(password, admin.passwordHash);
    if (!passwordMatch) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = await new SignJWT({ 
      id: admin.id, 
      email: admin.email,
      hasPhone: !!admin.phone 
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("24h")
      .sign(getJwtSecretKey());

    res.cookie("admin_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 1000, // 24 hours in ms
      path: "/",
    });

    return res.json({ success: true });

  } catch (error: any) {
    console.error("Login Error:", error);
    return res.status(500).json({ error: error.message || String(error) });
  }
};

export const logout = async (req: Request, res: Response) => {
  res.cookie("admin_token", "", {
    httpOnly: true,
    expires: new Date(0),
    path: "/",
  });
  return res.json({ success: true });
};

export const register = async (req: Request, res: Response) => {
  try {
    const result = registerSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({ error: result.error.issues[0].message });
    }

    const { email, phone, password, inviteKey } = result.data;

    if (inviteKey !== process.env.ADMIN_INVITE_KEY) {
      return res.status(403).json({ error: "Invalid Invite Key" });
    }

    const existingAdmin = await db.select().from(admins).where(eq(admins.email, email));
    if (existingAdmin.length > 0) {
      return res.status(400).json({ error: "Email already registered" });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const adminId = generateId();
    const formattedPhone = phone.replace(/[^0-9]/g, "");

    await db.insert(admins).values({
      id: adminId,
      email,
      phone: formattedPhone,
      passwordHash: hashedPassword,
    });

    return res.json({ success: true, message: "Admin registered successfully." });

  } catch (error) {
    console.error("Register Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

const resetSchema = z.object({
  email: z.string().email("Invalid email format"),
  newPassword: z.string().min(8, "Password must be at least 8 characters").regex(/[A-Z]/, "Password must contain at least one uppercase letter").regex(/[0-9]/, "Password must contain at least one number"),
  inviteKey: z.string().min(5, "Invite key is required"),
});

export const resetPassword = async (req: Request, res: Response) => {
  try {
    const validation = resetSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({ error: validation.error.issues[0].message });
    }

    const { email, newPassword, inviteKey } = validation.data;

    if (inviteKey !== process.env.ADMIN_INVITE_KEY) {
      return res.status(403).json({ error: "Invalid Secret Invite Key" });
    }

    const existingAdmin = await db.select().from(admins).where(eq(admins.email, email));
    if (existingAdmin.length === 0) {
      return res.status(404).json({ error: "Admin account not found" });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(newPassword, salt);

    await db.update(admins)
      .set({ passwordHash })
      .where(eq(admins.email, email));

    return res.json({ success: true, message: "Password reset successfully." });

  } catch (error) {
    console.error("Reset Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};
