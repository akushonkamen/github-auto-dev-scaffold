import "server-only";
import { and, count, desc, eq, gte, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { installations, runs, usageLogs } from "@/db/schema";

// ── Public types ────────────────────────────────────────────────────────────

export interface UsageSummary {
  totalTokens: number;
  totalCostUsd: number;
  totalMinutes: number;
  totalRuns: number;
}

export interface StageBreakdownRow {
  stage: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  callsCount: number;
}

export interface ModelBreakdownRow {
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  callsCount: number;
}

export interface RecentRunForTenant {
  id: number;
  issueNumber: number;
  prNumber: number | null;
  currentStage: string | null;
  status: string | null;
  aiTokensUsed: number | null;
  startedAt: Date | null;
  repoFullName: string;
  installationId: number;
}

// ── Internal helpers ────────────────────────────────────────────────────────

/**
 * Scoping WHERE clause for usage_logs-based queries.
 * Joins through runs → installations to filter by tenant + optional time range.
 */
function usageScope(tenantId: number, since: Date | null) {
  return and(
    eq(installations.tenantId, tenantId),
    since ? gte(usageLogs.calledAt, since) : undefined,
  );
}

/**
 * Scoping WHERE clause for run-based queries (minutes, runs count).
 * Joins through installations to filter by tenant + optional time range.
 */
function runScope(tenantId: number, since: Date | null) {
  return and(
    eq(installations.tenantId, tenantId),
    since ? gte(runs.startedAt, since) : undefined,
  );
}

// ── Queries ─────────────────────────────────────────────────────────────────

/**
 * Aggregate usage summary across all installations for a tenant.
 * Token + cost data comes from `usage_logs` (per-call granularity);
 * minutes + run count come from `runs` (per-run totals).
 */
export async function getUsageSummary(
  tenantId: number,
  since: Date | null,
): Promise<UsageSummary> {
  const [usageAgg] = await db
    .select({
      totalTokens: sql<number>`
        COALESCE(SUM(${usageLogs.inputTokens} + ${usageLogs.outputTokens}), 0)
      `,
      totalCostUsd: sql<number>`
        COALESCE(SUM(${usageLogs.costUsd})::numeric, 0)
      `,
    })
    .from(usageLogs)
    .innerJoin(runs, eq(usageLogs.runId, runs.id))
    .innerJoin(installations, eq(runs.installationId, installations.id))
    .where(usageScope(tenantId, since));

  const [runAgg] = await db
    .select({
      totalMinutes: sql<number>`COALESCE(SUM(${runs.aiMinutesUsed}), 0)`,
      totalRuns: count(),
    })
    .from(runs)
    .innerJoin(installations, eq(runs.installationId, installations.id))
    .where(runScope(tenantId, since));

  return {
    totalTokens: Number(usageAgg?.totalTokens ?? 0),
    totalCostUsd: Number(usageAgg?.totalCostUsd ?? 0),
    totalMinutes: Number(runAgg?.totalMinutes ?? 0),
    totalRuns: runAgg?.totalRuns ?? 0,
  };
}

/**
 * Token / cost / call count grouped by `usage_logs.stage`.
 * Useful for identifying which pipeline stage consumes the most budget.
 */
export async function getUsageByStage(
  tenantId: number,
  since: Date | null,
): Promise<StageBreakdownRow[]> {
  const rows = await db
    .select({
      stage: usageLogs.stage,
      inputTokens: sql<number>`COALESCE(SUM(${usageLogs.inputTokens}), 0)`,
      outputTokens: sql<number>`COALESCE(SUM(${usageLogs.outputTokens}), 0)`,
      costUsd: sql<number>`COALESCE(SUM(${usageLogs.costUsd})::numeric, 0)`,
      callsCount: count(),
    })
    .from(usageLogs)
    .innerJoin(runs, eq(usageLogs.runId, runs.id))
    .innerJoin(installations, eq(runs.installationId, installations.id))
    .where(usageScope(tenantId, since))
    .groupBy(usageLogs.stage)
    .orderBy(desc(sql`SUM(${usageLogs.costUsd})`));

  return rows.map(normaliseNumeric);
}

/**
 * Token / cost / call count grouped by `usage_logs.model`.
 * Useful for comparing model cost-efficiency across providers.
 */
export async function getUsageByModel(
  tenantId: number,
  since: Date | null,
): Promise<ModelBreakdownRow[]> {
  const rows = await db
    .select({
      model: usageLogs.model,
      inputTokens: sql<number>`COALESCE(SUM(${usageLogs.inputTokens}), 0)`,
      outputTokens: sql<number>`COALESCE(SUM(${usageLogs.outputTokens}), 0)`,
      costUsd: sql<number>`COALESCE(SUM(${usageLogs.costUsd})::numeric, 0)`,
      callsCount: count(),
    })
    .from(usageLogs)
    .innerJoin(runs, eq(usageLogs.runId, runs.id))
    .innerJoin(installations, eq(runs.installationId, installations.id))
    .where(usageScope(tenantId, since))
    .groupBy(usageLogs.model)
    .orderBy(desc(sql`SUM(${usageLogs.costUsd})`));

  return rows.map(normaliseNumeric);
}

/**
 * Cross-installation recent runs for a tenant.
 * Returns up to `limit` runs ordered by `started_at` descending.
 */
export async function getRecentRunsForTenant(
  tenantId: number,
  limit = 20,
): Promise<RecentRunForTenant[]> {
  return db
    .select({
      id: runs.id,
      issueNumber: runs.issueNumber,
      prNumber: runs.prNumber,
      currentStage: runs.currentStage,
      status: runs.status,
      aiTokensUsed: runs.aiTokensUsed,
      startedAt: runs.startedAt,
      repoFullName: installations.repoFullName,
      installationId: installations.id,
    })
    .from(runs)
    .innerJoin(installations, eq(runs.installationId, installations.id))
    .where(eq(installations.tenantId, tenantId))
    .orderBy(desc(runs.startedAt))
    .limit(limit);
}

// ── Internal helpers ────────────────────────────────────────────────────────

/**
 * Drizzle returns numeric aggregates as strings; normalise to number.
 */
function normaliseNumeric<T extends { inputTokens: number; outputTokens: number; costUsd: number }>(
  row: T,
): T {
  return {
    ...row,
    inputTokens: Number(row.inputTokens),
    outputTokens: Number(row.outputTokens),
    costUsd: Number(row.costUsd),
  };
}
