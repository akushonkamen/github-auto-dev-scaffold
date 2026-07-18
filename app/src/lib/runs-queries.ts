import "server-only";
import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { installations, runs, usageLogs } from "@/db/schema";

/**
 * Run-scoped DB queries for the dashboard (Issue #7).
 *
 * All functions take the installation DB id (not GitHub installation_id) so
 * callers must first resolve `dashboard/installations/[id]` → that route's
 * access-control invariant still gates every read here.
 */

export interface RunRow {
  id: number;
  installationId: number;
  issueNumber: number;
  prNumber: number | null;
  currentStage: string | null;
  status: string | null;
  aiTokensUsed: number | null;
  aiMinutesUsed: number | null;
  startedAt: Date | null;
  completedAt: Date | null;
}

export async function listRecentRunsForInstallation(
  installationDbId: number,
  limit = 50,
): Promise<RunRow[]> {
  const rows = await db
    .select({
      id: runs.id,
      installationId: runs.installationId,
      issueNumber: runs.issueNumber,
      prNumber: runs.prNumber,
      currentStage: runs.currentStage,
      status: runs.status,
      aiTokensUsed: runs.aiTokensUsed,
      aiMinutesUsed: runs.aiMinutesUsed,
      startedAt: runs.startedAt,
      completedAt: runs.completedAt,
    })
    .from(runs)
    .where(eq(runs.installationId, installationDbId))
    .orderBy(desc(runs.startedAt))
    .limit(limit);
  return rows;
}

/**
 * Look up a run by id, scoped to a specific installation. Returns null if the
 * run does not exist or does not belong to the given installation. Scoping
 * prevents a user with a valid run id from another tenant from reading it
 * (defense-in-depth on top of the route's GitHub-API access check).
 */
export async function findRunInInstallation(
  runId: number,
  installationDbId: number,
): Promise<RunRow | null> {
  const row = await db
    .select({
      id: runs.id,
      installationId: runs.installationId,
      issueNumber: runs.issueNumber,
      prNumber: runs.prNumber,
      currentStage: runs.currentStage,
      status: runs.status,
      aiTokensUsed: runs.aiTokensUsed,
      aiMinutesUsed: runs.aiMinutesUsed,
      startedAt: runs.startedAt,
      completedAt: runs.completedAt,
    })
    .from(runs)
    .where(and(eq(runs.id, runId), eq(runs.installationId, installationDbId)))
    .limit(1);
  return row[0] ?? null;
}

/**
 * Per-stage audit trail for a run. Used by the detail page table.
 */
export interface UsageLogRow {
  id: number;
  stage: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: string | null;
  calledAt: Date | null;
}

export async function listUsageLogsForRun(
  runId: number,
): Promise<UsageLogRow[]> {
  const rows = await db
    .select({
      id: usageLogs.id,
      stage: usageLogs.stage,
      model: usageLogs.model,
      inputTokens: usageLogs.inputTokens,
      outputTokens: usageLogs.outputTokens,
      costUsd: usageLogs.costUsd,
      calledAt: usageLogs.calledAt,
    })
    .from(usageLogs)
    .where(eq(usageLogs.runId, runId))
    .orderBy(desc(usageLogs.calledAt));
  return rows;
}

/**
 * Resolve a run id → its parent installation DB id. Used by the SSE endpoint
 * to confirm the run belongs to an installation the session user can access
 * before streaming updates.
 */
export async function findInstallationForRun(
  runId: number,
): Promise<{ installationDbId: number; installationGithubId: number } | null> {
  const row = await db
    .select({
      installationDbId: installations.id,
      installationGithubId: installations.installationId,
    })
    .from(runs)
    .innerJoin(installations, eq(runs.installationId, installations.id))
    .where(eq(runs.id, runId))
    .limit(1);
  return row[0] ?? null;
}
