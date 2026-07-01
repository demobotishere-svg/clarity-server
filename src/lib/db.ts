import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../db/schema';
import crypto from 'crypto';

const connectionString = `${process.env.DATABASE_URL}`;

const pool = new Pool({ connectionString });

export const db = drizzle(pool, { schema });

// Helper function to generate unique text IDs for Drizzle inserts (simulating Prisma's cuid)
export const generateId = () => {
  return crypto.randomBytes(12).toString("hex"); // e.g., '1a2b3c4d5e6f7a8b9c0d1e2f'
};
