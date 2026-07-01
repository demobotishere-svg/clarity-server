import { Request, Response, NextFunction } from "express";
import { jwtVerify } from "jose";

const getJwtSecretKey = () => {
  const secret = process.env.JWT_SECRET || "fallback_secret_key_change_me";
  return new TextEncoder().encode(secret);
};

export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  const token = req.cookies.admin_token;

  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const decoded = await jwtVerify(token, getJwtSecretKey());
    
    // Attach user payload to request for controllers to use
    (req as any).admin = decoded.payload;
    
    next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
};

export const requireCronAuth = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: "Unauthorized cron request" });
  }

  const token = authHeader.split(' ')[1];
  
  // If a CRON_SECRET is defined, validate against it.
  // Otherwise, default to rejecting.
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret || token !== expectedSecret) {
    return res.status(401).json({ error: "Invalid cron secret" });
  }

  next();
};
