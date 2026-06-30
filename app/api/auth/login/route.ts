import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { admins } from "@/db/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import { loginSchema } from "@/lib/validations";

const getJwtSecretKey = () => {
  const secret = process.env.JWT_SECRET || "fallback_secret_key_change_me";
  return new TextEncoder().encode(secret);
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const validation = loginSchema.safeParse(body);
    
    if (!validation.success) {
      return new NextResponse(validation.error.errors[0].message, { status: 400 });
    }

    const { email, password } = validation.data;

    const adminResults = await db.select().from(admins).where(eq(admins.email, email));
    if (adminResults.length === 0) {
      return new NextResponse("Invalid credentials", { status: 401 });
    }

    const admin = adminResults[0];

    const passwordMatch = await bcrypt.compare(password, admin.passwordHash);
    if (!passwordMatch) {
      return new NextResponse("Invalid credentials", { status: 401 });
    }

    // Create JWT token
    const token = await new SignJWT({ 
      id: admin.id, 
      email: admin.email,
      hasPhone: !!admin.phone 
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("24h") // Token expires in 24 hours
      .sign(getJwtSecretKey());

    // Create response and set HttpOnly cookie
    const response = NextResponse.json({ success: true });
    
    response.cookies.set({
      name: "admin_token",
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24, // 24 hours
      path: "/",
    });

    return response;

  } catch (error) {
    console.error("Login Error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
