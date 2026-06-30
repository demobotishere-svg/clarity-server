import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { admins } from "@/db/schema";
import { eq } from "drizzle-orm";
import { jwtVerify, SignJWT } from "jose";

const getJwtSecretKey = () => {
  const secret = process.env.JWT_SECRET || "fallback_secret_key_change_me";
  return new TextEncoder().encode(secret);
};

export async function POST(request: Request) {
  try {
    const token = request.headers.get("cookie")?.split("; ").find(c => c.startsWith("admin_token="))?.split("=")[1];
    
    if (!token) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const decoded = await jwtVerify(token, getJwtSecretKey());
    const adminId = decoded.payload.id as string;
    const adminEmail = decoded.payload.email as string;

    const body = await request.json();
    const phone = body.phone;

    if (!phone || typeof phone !== "string" || phone.length < 10) {
      return new NextResponse("Invalid phone number", { status: 400 });
    }

    // Save to database
    await db.update(admins).set({ phone }).where(eq(admins.id, adminId));

    // Re-issue JWT token with hasPhone: true
    const newToken = await new SignJWT({ 
      id: adminId, 
      email: adminEmail,
      hasPhone: true 
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("24h")
      .sign(getJwtSecretKey());

    const response = NextResponse.json({ success: true });
    
    response.cookies.set({
      name: "admin_token",
      value: newToken,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24, // 24 hours
      path: "/",
    });

    return response;

  } catch (error) {
    console.error("Setup API Error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
