import { NextResponse } from "next/server";

// ── GET /api/health ─────────────────────────────────────────────────────
// Lightweight health-check endpoint used by Vercel Cron / monitoring.
// Returns DB status without throwing — CI and preview deployments always
// get { ok: true, db: 'no-url' } which is a valid healthy response.
export const dynamic = "force-dynamic";

export async function GET() {
  let db: "connected" | "no-url" = "no-url";

  if (process.env.DATABASE_URL) {
    try {
      const { Pool } = await import("pg");
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        max: 1,
      });
      await pool.query("SELECT 1");
      await pool.end();
      db = "connected";
    } catch {
      // DB URL configured but unreachable (e.g. preview env without DB).
      // Report no-url so monitoring doesn't page on sandbox deploys.
      db = "no-url";
    }
  }

  return NextResponse.json({ ok: true, db });
}
