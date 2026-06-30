import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { admins } from "@/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { z } from "zod";

const resetSchema = z.object({
  email: z.string().email("Invalid email format"),
  newPassword: z.string().min(8, "Password must be at least 8 characters").regex(/[A-Z]/, "Password must contain at least one uppercase letter").regex(/[0-9]/, "Password must contain at least one number"),
  inviteKey: z.string().min(5, "Invite key is required"),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const validation = resetSchema.safeParse(body);

    if (!validation.success) {
      return new NextResponse(validation.error.errors[0].message, { status: 400 });
    }

    const { email, newPassword, inviteKey } = validation.data;

    // Verify Invite Key acts as the ultimate authorization
    if (inviteKey !== process.env.ADMIN_INVITE_KEY) {
      return new NextResponse("Invalid Secret Invite Key", { status: 403 });
    }

    // Verify Admin exists
    const existingAdmin = await db.select().from(admins).where(eq(admins.email, email));
    if (existingAdmin.length === 0) {
      return new NextResponse("Admin account not found", { status: 404 });
    }

    // Hash new password and update
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(newPassword, salt);

    await db.update(admins)
      .set({ passwordHash })
      .where(eq(admins.email, email));

    return NextResponse.json({ success: true, message: "Password reset successfully." });

  } catch (error) {
    console.error("Reset Error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
