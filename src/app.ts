import "dotenv/config";
import "./lib/env";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import path from "path";

import authRoutes from "./routes/authRoutes";
import adminRoutes from "./routes/adminRoutes";
import leadsRoutes from "./routes/leadsRoutes";
import whatsappRoutes from "./routes/whatsappRoutes";
import razorpayRoutes from "./routes/razorpayRoutes";
import bulkRoutes from "./routes/bulkRoutes";
import exportRoutes from "./routes/exportRoutes";
import cronRoutes from "./routes/cronRoutes";
import { apiLimiter } from "./middlewares/rateLimiter";

const app = express();
const PORT = process.env.PORT || 3001;

// Middlewares
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:3000",
  credentials: true
}));
app.use(express.json({
  verify: (req: any, res, buf) => {
    req.rawBody = buf.toString();
  }
}));
app.use(cookieParser());
app.use("/api", apiLimiter); // Apply general limit to all API routes

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// Serve PDF reports statically so WhatsApp Cloud API can download them
app.use("/reports", express.static(path.join(process.cwd(), "public", "reports")));

// Register routes
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/leads", leadsRoutes);
app.use("/api/whatsapp", whatsappRoutes);
app.use("/api/razorpay", razorpayRoutes);
app.use("/api/bulk", bulkRoutes);
import { globalErrorHandler } from "./middlewares/errorHandler";

// ... (existing routes)
app.use("/api/export", exportRoutes);
app.use("/api/cron", cronRoutes);

app.use(globalErrorHandler);

export default app;
