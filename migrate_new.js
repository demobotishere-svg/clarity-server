require('dotenv').config({ path: '.env' });
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
  try {
    console.log('Creating new tables for Security & Bulk Messaging...');
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "RateLimit" (
        "id" text PRIMARY KEY NOT NULL,
        "ip" text NOT NULL,
        "endpoint" text NOT NULL,
        "hits" integer DEFAULT 1 NOT NULL,
        "windowReset" timestamp (3) NOT NULL
      );

      CREATE TABLE IF NOT EXISTS "ProcessedWebhook" (
        "id" text PRIMARY KEY NOT NULL,
        "messageId" text NOT NULL,
        "processedAt" timestamp (3) DEFAULT now() NOT NULL,
        CONSTRAINT "ProcessedWebhook_messageId_unique" UNIQUE("messageId")
      );

      CREATE TABLE IF NOT EXISTS "BulkBatch" (
        "id" text PRIMARY KEY NOT NULL,
        "adminId" text NOT NULL,
        "templateName" text NOT NULL,
        "totalCount" integer NOT NULL,
        "processedCount" integer DEFAULT 0 NOT NULL,
        "failedCount" integer DEFAULT 0 NOT NULL,
        "status" text DEFAULT 'PENDING' NOT NULL,
        "createdAt" timestamp (3) DEFAULT now() NOT NULL
      );

      CREATE TABLE IF NOT EXISTS "PendingMessage" (
        "id" text PRIMARY KEY NOT NULL,
        "batchId" text NOT NULL REFERENCES "BulkBatch"("id") ON DELETE CASCADE,
        "leadId" text NOT NULL REFERENCES "Lead"("id") ON DELETE CASCADE,
        "templateName" text NOT NULL,
        "status" text DEFAULT 'QUEUED' NOT NULL,
        "errorReason" text,
        "lockedAt" timestamp (3),
        "createdAt" timestamp (3) DEFAULT now() NOT NULL,
        "processedAt" timestamp (3)
      );
    `);
    console.log('Migration successful.');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await pool.end();
  }
}

migrate();
