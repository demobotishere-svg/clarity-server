require('dotenv').config({ path: '.env' });
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
  try {
    console.log('Creating Admin table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "Admin" (
        "id" text PRIMARY KEY NOT NULL,
        "email" text NOT NULL,
        "passwordHash" text NOT NULL,
        "createdAt" timestamp (3) DEFAULT now() NOT NULL,
        CONSTRAINT "Admin_email_unique" UNIQUE("email")
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
