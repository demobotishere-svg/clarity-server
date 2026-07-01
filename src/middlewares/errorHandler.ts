import { Request, Response, NextFunction } from "express";
import fs from "fs";
import path from "path";

const logDir = path.join(process.cwd(), "logs");
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}

const errorLogStream = fs.createWriteStream(path.join(logDir, "error.log"), { flags: "a" });

export const globalErrorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
  const timestamp = new Date().toISOString();
  const errorMsg = `[${timestamp}] ERROR: ${err.message || String(err)}\nStack: ${err.stack}\nPath: ${req.path}\nMethod: ${req.method}\n\n`;

  console.error("\x1b[31m%s\x1b[0m", "🚨 UNHANDLED EXCEPTION CAUGHT:");
  console.error(errorMsg);

  errorLogStream.write(errorMsg);

  res.status(500).json({
    error: "Internal Server Error",
    message: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
};

// Catch unhandled promise rejections system-wide
process.on("unhandledRejection", (reason: any, promise: Promise<any>) => {
  const timestamp = new Date().toISOString();
  const errorMsg = `[${timestamp}] UNHANDLED REJECTION: ${reason?.message || String(reason)}\nStack: ${reason?.stack}\n\n`;
  console.error("\x1b[31m%s\x1b[0m", "🚨 UNHANDLED PROMISE REJECTION:");
  console.error(errorMsg);
  errorLogStream.write(errorMsg);
});
