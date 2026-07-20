import "server-only";
import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { tenants } from "@/db/schema";

interface SessionLike {
  user?: { githubId?: number } & Record<string, unknown>;
}

/**
 * Resolve the tenant row for the currently signed-in user via
 * `tenants.githubId === session.githubId`. Returns `null` if the session
 * has no githubId or the tenant row does not exist yet ( installations
 * webhook may not have fired for this user ).
 *
 * Every BYOK query MUST go through this resolver so the tenant scope is
 * always derived from the session — never from a client-supplied id.
 */
export async function getTenantIdForSessionUser(
  session: SessionLike | null | undefined,
): Promise<number | null> {
  const githubId = session?.user?.githubId;
  if (typeof githubId !== "number" || !Number.isFinite(githubId)) return null;

  const rows = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.githubId, githubId))
    .limit(1);
  return rows[0]?.id ?? null;
}
