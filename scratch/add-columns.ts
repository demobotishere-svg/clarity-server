import { Client } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

async function main() {
  await client.connect();
  try {
    await client.query('ALTER TABLE "Assessment" ADD COLUMN IF NOT EXISTS "summary" text;');
    await client.query('ALTER TABLE "Assessment" ADD COLUMN IF NOT EXISTS "profession" text;');
    console.log("Columns 'summary' and 'profession' added successfully.");
  } catch (err) {
    console.error("Error adding columns:", err);
  } finally {
    await client.end();
  }
}

main();
