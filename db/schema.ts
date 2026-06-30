import { pgTable, text, timestamp, integer, pgEnum, boolean } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// Enums (mapped precisely to existing Prisma enums in Postgres)
export const assessmentStatusEnum = pgEnum("AssessmentStatus", ["PENDING", "IN_PROGRESS", "COMPLETED"]);
export const roleEnum = pgEnum("Role", ["USER", "SYSTEM"]);

// Admins Table for Custom Auth
export const admins = pgTable("Admin", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  phone: text("phone"), // New field for notifications
  passwordHash: text("passwordHash").notNull(),
  createdAt: timestamp("createdAt", { precision: 3, mode: "date" }).defaultNow().notNull(),
});

// Leads Table
export const leads = pgTable("Lead", {
  // Prisma mapped 'id' to text/varchar
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  phone: text("phone").notNull().unique(),
  createdAt: timestamp("createdAt", { precision: 3, mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { precision: 3, mode: "date" }).notNull(),
  hasPaid: boolean("hasPaid").default(false),
  paymentId: text("paymentId"),
});

// Assessments Table
export const assessments = pgTable("Assessment", {
  id: text("id").primaryKey(),
  leadId: text("leadId").notNull().unique().references(() => leads.id, { onDelete: 'cascade' }),
  status: assessmentStatusEnum("status").default("PENDING").notNull(),
  currentQuestion: integer("currentQuestion").default(0).notNull(),
  score: integer("score"),
  summary: text("summary"),
  profession: text("profession"),
  report: text("report"),
  pdfUrl: text("pdfUrl"),
  createdAt: timestamp("createdAt", { precision: 3, mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { precision: 3, mode: "date" }).notNull(),
});

// Messages Table
export const messages = pgTable("Message", {
  id: text("id").primaryKey(),
  assessmentId: text("assessmentId").notNull().references(() => assessments.id, { onDelete: 'cascade' }),
  role: roleEnum("role").notNull(),
  content: text("content").notNull(),
  isAcceptable: boolean("isAcceptable"),
  createdAt: timestamp("createdAt", { precision: 3, mode: "date" }).defaultNow().notNull(),
});

// ActivityLogs Table
export const activityLogs = pgTable("ActivityLog", {
  id: text("id").primaryKey(),
  leadId: text("leadId").references(() => leads.id, { onDelete: 'cascade' }),
  action: text("action").notNull(),
  details: text("details"),
  createdAt: timestamp("createdAt", { precision: 3, mode: "date" }).defaultNow().notNull(),
});


// RazorpayPayments Table
export const razorpayPayments = pgTable("RazorpayPayment", {
  id: text("id").primaryKey(),
  leadId: text("leadId").references(() => leads.id, { onDelete: 'set null' }),
  paymentId: text("paymentId").notNull(),
  orderId: text("orderId"),
  amount: integer("amount").notNull(),
  currency: text("currency").notNull(),
  status: text("status").notNull(),
  method: text("method"),
  contact: text("contact"),
  email: text("email"),
  cardNetwork: text("cardNetwork"),
  cardLast4: text("cardLast4"),
  fee: integer("fee"),
  tax: integer("tax"),
  createdAt: timestamp("createdAt", { precision: 3, mode: "date" }).defaultNow().notNull(),
});


// RateLimits Table
export const rateLimits = pgTable("RateLimit", {
  id: text("id").primaryKey(),
  ip: text("ip").notNull(),
  endpoint: text("endpoint").notNull(),
  hits: integer("hits").default(1).notNull(),
  windowReset: timestamp("windowReset", { precision: 3, mode: "date" }).notNull(),
});

// ProcessedWebhooks Table (WhatsApp Idempotency)
export const processedWebhooks = pgTable("ProcessedWebhook", {
  id: text("id").primaryKey(),
  messageId: text("messageId").notNull().unique(),
  processedAt: timestamp("processedAt", { precision: 3, mode: "date" }).defaultNow().notNull(),
});

// BulkBatches Table
export const bulkBatches = pgTable("BulkBatch", {
  id: text("id").primaryKey(),
  adminId: text("adminId").notNull(),
  templateName: text("templateName").notNull(),
  totalCount: integer("totalCount").notNull(),
  processedCount: integer("processedCount").default(0).notNull(),
  failedCount: integer("failedCount").default(0).notNull(),
  status: text("status").default("PENDING").notNull(), // PENDING, PROCESSING, COMPLETED, FAILED
  createdAt: timestamp("createdAt", { precision: 3, mode: "date" }).defaultNow().notNull(),
});

// PendingMessages Table (Queue)
export const pendingMessages = pgTable("PendingMessage", {
  id: text("id").primaryKey(),
  batchId: text("batchId").notNull().references(() => bulkBatches.id, { onDelete: 'cascade' }),
  leadId: text("leadId").notNull().references(() => leads.id, { onDelete: 'cascade' }),
  templateName: text("templateName").notNull(),
  status: text("status").default("QUEUED").notNull(), // QUEUED, PROCESSING, SENT, DELIVERED, READ, FAILED
  messageId: text("messageId"), // Stores Meta's wamid
  errorReason: text("errorReason"),
  lockedAt: timestamp("lockedAt", { precision: 3, mode: "date" }), // Used by cron worker
  createdAt: timestamp("createdAt", { precision: 3, mode: "date" }).defaultNow().notNull(),
  processedAt: timestamp("processedAt", { precision: 3, mode: "date" }),
});

// Relations (mimicking Prisma's include logic)
export const leadsRelations = relations(leads, ({ one, many }) => ({
  assessment: one(assessments, {
    fields: [leads.id],
    references: [assessments.leadId],
  }),
  activityLogs: many(activityLogs),
  razorpayPayments: many(razorpayPayments),
}));

export const assessmentsRelations = relations(assessments, ({ one, many }) => ({
  lead: one(leads, {
    fields: [assessments.leadId],
    references: [leads.id],
  }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  assessment: one(assessments, {
    fields: [messages.assessmentId],
    references: [assessments.id],
  }),
}));

export const activityLogsRelations = relations(activityLogs, ({ one }) => ({
  lead: one(leads, {
    fields: [activityLogs.leadId],
    references: [leads.id],
  }),
}));

export const razorpayPaymentsRelations = relations(razorpayPayments, ({ one }) => ({
  lead: one(leads, {
    fields: [razorpayPayments.leadId],
    references: [leads.id],
  }),
}));
