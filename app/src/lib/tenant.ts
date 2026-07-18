import "server-only";
import { eq } from "drizzle-orm";
import type { Session } from "next-auth";

import { db } from "@/db/client";
import { tenants } from "@/db/schema";

/**
 * Resolve the tenant ID for a session-authenticated user.
 *
 * Reads `githubId` from the session (populated by the JWT callback in
 * auth/config.ts), looks up the matching `tenants.githubId` row, and
 * returns `tenants.id` or `null` if the user has no tenant record.
 *
 * All BYOK queries MUST be scoped by the returned tenantId — never accept
 * a tenant id from client input (security constraint).
 */
export async function getTenantIdForSessionUser(
  session: Session,
): Promise<number | null> {
  const githubId = (session.user as Record<string, unknown> | undefined)
    ?.githubId as number | undefined;

  if (!githubId) return null;

  const row = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.githubId, githubId))
    .limit(1);

  return row[0]?.id ?? null;
}
