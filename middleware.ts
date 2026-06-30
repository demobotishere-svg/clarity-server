import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const getJwtSecretKey = () => {
  const secret = process.env.JWT_SECRET || "fallback_secret_key_change_me";
  return new TextEncoder().encode(secret);
};

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // We want to protect /admin and /api/export
  if (pathname.startsWith('/admin') || pathname.startsWith('/api/export')) {
    const token = req.cookies.get('admin_token')?.value;

    if (!token) {
      return NextResponse.redirect(new URL('/auth/login', req.url));
    }

    try {
      const decoded = await jwtVerify(token, getJwtSecretKey());
      
      // Force admin setup if phone is missing
      if (!decoded.payload.hasPhone && pathname !== '/admin/setup' && !pathname.startsWith('/api/')) {
        return NextResponse.redirect(new URL('/admin/setup', req.url));
      }
      
      return NextResponse.next();
    } catch (error) {
      // Invalid or expired token
      return NextResponse.redirect(new URL('/auth/login', req.url));
    }
  }

  // If user is already logged in and tries to go to login/register, redirect to dashboard
  if (pathname === '/auth/login' || pathname === '/auth/register') {
    const token = req.cookies.get('admin_token')?.value;
    if (token) {
      try {
        await jwtVerify(token, getJwtSecretKey());
        return NextResponse.redirect(new URL('/admin', req.url));
      } catch (error) {
        // Let them go to auth if token is invalid
        return NextResponse.next();
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/api/export/:path*'],
};
