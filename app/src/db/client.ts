import "server-only";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

const dbUrl = process.env.DATABASE_URL;

if (!dbUrl) {
  throw new Error(
    "DATABASE_URL is not set. Define it in .env.local (see .env.example). " +
      "v1 uses Neon Postgres — see docs/app-launch-checklist.md A3-6.",
  );
}

const pool = new Pool({ connectionString: dbUrl });

export const db = drizzle(pool, { schema });

export { schema };
export * from "./schema";
