import "server-only";
import { count, desc, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { installations, runs } from "@/db/schema";

/**
 * DB queries for the dashboard (Issue #6).
 *
 * The dashboard cross-references the GitHub `/user/installations` API with
 * our `installations` table to surface repo metadata + run counts. The
 * authoritative list of installations a user can access still comes from
 * GitHub (the user OAuth token); we look each row up by `installation_id`
 * to enrich it with DB state.
 */

export interface InstallationWithMeta {
  id: number;
  installationId: number;
  tenantId: number;
  repoFullName: string;
  installedAt: Date | null;
  uninstalledAt: Date | null;
  runsCount: number;
}

/**
 * Look up a single installation row by GitHub installation_id. Returns null
 * if the installation has never been seen by the webhook (e.g. user just
 * installed and the `installation` event has not landed yet).
 */
export async function findInstallationByGithubId(
  installationGithubId: number,
): Promise<InstallationWithMeta | null> {
  const row = await db
    .select({
      id: installations.id,
      installationId: installations.installationId,
      tenantId: installations.tenantId,
      repoFullName: installations.repoFullName,
      installedAt: installations.installedAt,
      uninstalledAt: installations.uninstalledAt,
    })
    .from(installations)
    .where(eq(installations.installationId, installationGithubId))
    .limit(1);
  if (!row[0]) return null;

  const runsCount = await countRunsForInstallation(row[0].id);
  return { ...row[0], runsCount };
}

/**
 * Resolve an active installation DB id → enriched row. Used by the detail
 * page (/dashboard/installations/[id]) and by the active-installation cookie
 * resolver. Returns null if the row is missing or soft-deleted.
 */
export async function findInstallationByDbId(
  dbId: number,
): Promise<InstallationWithMeta | null> {
  const row = await db
    .select({
      id: installations.id,
      installationId: installations.installationId,
      tenantId: installations.tenantId,
      repoFullName: installations.repoFullName,
      installedAt: installations.installedAt,
      uninstalledAt: installations.uninstalledAt,
    })
    .from(installations)
    .where(eq(installations.id, dbId))
    .limit(1);
  if (!row[0]) return null;

  const runsCount = await countRunsForInstallation(row[0].id);
  return { ...row[0], runsCount };
}

export async function countRunsForInstallation(
  installationDbId: number,
): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(runs)
    .where(eq(runs.installationId, installationDbId));
  return Number(rows[0]?.value ?? 0);
}

/**
 * Recent runs for an installation (used in the detail page preview; full
 * list + SSE lands in Issue #7).
 */
export async function recentRunsForInstallation(
  installationDbId: number,
  limit = 10,
) {
  return db
    .select({
      id: runs.id,
      issueNumber: runs.issueNumber,
      prNumber: runs.prNumber,
      currentStage: runs.currentStage,
      status: runs.status,
      aiTokensUsed: runs.aiTokensUsed,
      startedAt: runs.startedAt,
      completedAt: runs.completedAt,
    })
    .from(runs)
    .where(eq(runs.installationId, installationDbId))
    .orderBy(desc(runs.startedAt))
    .limit(limit);
}
