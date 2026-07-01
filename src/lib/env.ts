import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  WHATSAPP_TOKEN: z.string().min(1, "WHATSAPP_TOKEN is required"),
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(1, "WHATSAPP_PHONE_NUMBER_ID is required"),
  WHATSAPP_VERIFY_TOKEN: z.string().min(1, "WHATSAPP_VERIFY_TOKEN is required"),
  WHATSAPP_APP_SECRET: z.string().min(1, "WHATSAPP_APP_SECRET is required for webhook signature validation"),
  GEMINI_API_KEY: z.string().min(1, "GEMINI_API_KEY is required"),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  ADMIN_INVITE_KEY: z.string().min(1, "ADMIN_INVITE_KEY is required"),
  JWT_SECRET: z.string().min(1, "JWT_SECRET is required"),
  CRON_SECRET: z.string().min(1, "CRON_SECRET is required for internal triggers"),
  PORT: z.string().optional().default("3001"),
  FRONTEND_URL: z.string().optional(),
});

export const env = envSchema.safeParse(process.env);

if (!env.success) {
  console.error("❌ Invalid environment variables:");
  console.error(JSON.stringify(env.error.format(), null, 2));
  process.exit(1);
}

// Ensure process.env has the parsed values (with defaults if any)
Object.assign(process.env, env.data);
