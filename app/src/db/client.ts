import "server-only";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

// Lazy: don't throw at module load — Next.js build / typecheck must succeed
// without DATABASE_URL. Connection errors surface at first query, which is
// the right granularity (preview deploys without DB shouldn't crash build).
const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgresql://unset:unset@localhost:5432/unset?sslmode=disable",
  max: 5,
});

export const db = drizzle(pool, { schema });

export { schema };
export * from "./schema";
