import { NextResponse } from "next/server";
import { db, generateId } from "@/lib/db";
import { admins } from "@/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { registerSchema } from "@/lib/validations";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = registerSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json({ error: result.error.errors[0].message }, { status: 400 });
    }

    const { email, phone, password, inviteKey } = result.data;

    if (inviteKey !== process.env.ADMIN_INVITE_KEY) {
      return new NextResponse("Invalid Invite Key", { status: 403 });
    }

    const existingAdmin = await db.select().from(admins).where(eq(admins.email, email));
    if (existingAdmin.length > 0) {
      return new NextResponse("Email already registered", { status: 400 });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const adminId = generateId();
    // format phone slightly
    const formattedPhone = phone.replace(/[^0-9]/g, "");

    await db.insert(admins).values({
      id: adminId,
      email,
      phone: formattedPhone,
      passwordHash: hashedPassword,
    });

    return NextResponse.json({ success: true, message: "Admin registered successfully." });

  } catch (error) {
    console.error("Register Error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
