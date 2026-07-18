import "server-only";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { installations, runs, usageLogs } from "@/db/schema";

export interface UsageSummary {
  totalTokens: number;
  totalCostUsd: number;
  totalMinutes: number;
  totalRuns: number;
}

export interface StageBreakdown {
  stage: string;
  totalTokens: number;
  totalCostUsd: number;
  calls: number;
}

export interface ModelBreakdown {
  model: string;
  totalTokens: number;
  totalCostUsd: number;
  calls: number;
}

export interface RecentRunRow {
  id: number;
  installationId: number;
  installationGithubId: number;
  repoFullName: string | null;
  issueNumber: number;
  prNumber: number | null;
  currentStage: string | null;
  status: string | null;
  aiTokensUsed: number;
  aiMinutesUsed: number;
  startedAt: Date | null;
}

/**
 * All aggregations join usage_logs → runs → installations → tenants via
 * `installations.tenant_id`. The tenantId parameter is the only scoping
 * knob — every query filters on it so cross-tenant reads are impossible.
 *
 * `since` is optional; when undefined, no lower bound (all-time).
 */
function tenantScope(tenantId: number) {
  return eq(installations.tenantId, tenantId);
}

export async function getUsageSummary(
  tenantId: number,
  since: Date | null,
): Promise<UsageSummary> {
  const conditions = [tenantScope(tenantId)];
  if (since) conditions.push(gte(usageLogs.calledAt, since));

  const row = await db
    .select({
      totalTokens: sql<number>`coalesce(sum(${usageLogs.inputTokens} + ${usageLogs.outputTokens}), 0)`.as("total_tokens"),
      totalCostUsd: sql<number>`coalesce(sum(${usageLogs.costUsd}), 0)`.as("total_cost_usd"),
      totalCalls: sql<number>`count(${usageLogs.id})`.as("total_calls"),
    })
    .from(usageLogs)
    .innerJoin(runs, eq(runs.id, usageLogs.runId))
    .innerJoin(installations, eq(installations.id, runs.installationId))
    .where(and(...conditions));

  // AI minutes + run count are at the runs level, not usage_logs.
  const runConditions = [tenantScope(tenantId)];
  if (since) runConditions.push(gte(runs.startedAt, since));
  const runRow = await db
    .select({
      totalMinutes: sql<number>`coalesce(sum(${runs.aiMinutesUsed}), 0)`.as("total_minutes"),
      totalRuns: sql<number>`count(${runs.id})`.as("total_runs"),
    })
    .from(runs)
    .innerJoin(installations, eq(installations.id, runs.installationId))
    .where(and(...runConditions));

  return {
    totalTokens: Number(row[0]?.totalTokens ?? 0),
    totalCostUsd: Number(row[0]?.totalCostUsd ?? 0),
    totalMinutes: Number(runRow[0]?.totalMinutes ?? 0),
    totalRuns: Number(runRow[0]?.totalRuns ?? 0),
  };
}

export async function getUsageByStage(
  tenantId: number,
  since: Date | null,
): Promise<StageBreakdown[]> {
  const conditions = [tenantScope(tenantId)];
  if (since) conditions.push(gte(usageLogs.calledAt, since));

  const rows = await db
    .select({
      stage: usageLogs.stage,
      totalTokens: sql<number>`coalesce(sum(${usageLogs.inputTokens} + ${usageLogs.outputTokens}), 0)`.as("total_tokens"),
      totalCostUsd: sql<number>`coalesce(sum(${usageLogs.costUsd}), 0)`.as("total_cost_usd"),
      calls: sql<number>`count(${usageLogs.id})`.as("calls"),
    })
    .from(usageLogs)
    .innerJoin(runs, eq(runs.id, usageLogs.runId))
    .innerJoin(installations, eq(installations.id, runs.installationId))
    .where(and(...conditions))
    .groupBy(usageLogs.stage)
    .orderBy(desc(sql`total_tokens`));

  return rows.map((r) => ({
    stage: r.stage,
    totalTokens: Number(r.totalTokens),
    totalCostUsd: Number(r.totalCostUsd),
    calls: Number(r.calls),
  }));
}

export async function getUsageByModel(
  tenantId: number,
  since: Date | null,
): Promise<ModelBreakdown[]> {
  const conditions = [tenantScope(tenantId)];
  if (since) conditions.push(gte(usageLogs.calledAt, since));

  const rows = await db
    .select({
      model: usageLogs.model,
      totalTokens: sql<number>`coalesce(sum(${usageLogs.inputTokens} + ${usageLogs.outputTokens}), 0)`.as("total_tokens"),
      totalCostUsd: sql<number>`coalesce(sum(${usageLogs.costUsd}), 0)`.as("total_cost_usd"),
      calls: sql<number>`count(${usageLogs.id})`.as("calls"),
    })
    .from(usageLogs)
    .innerJoin(runs, eq(runs.id, usageLogs.runId))
    .innerJoin(installations, eq(installations.id, runs.installationId))
    .where(and(...conditions))
    .groupBy(usageLogs.model)
    .orderBy(desc(sql`total_tokens`));

  return rows.map((r) => ({
    model: r.model,
    totalTokens: Number(r.totalTokens),
    totalCostUsd: Number(r.totalCostUsd),
    calls: Number(r.calls),
  }));
}

export async function getRecentRunsForTenant(
  tenantId: number,
  limit = 20,
): Promise<RecentRunRow[]> {
  const rows = await db
    .select({
      id: runs.id,
      installationId: installations.id,
      installationGithubId: installations.installationId,
      repoFullName: installations.repoFullName,
      issueNumber: runs.issueNumber,
      prNumber: runs.prNumber,
      currentStage: runs.currentStage,
      status: runs.status,
      aiTokensUsed: runs.aiTokensUsed,
      aiMinutesUsed: runs.aiMinutesUsed,
      startedAt: runs.startedAt,
    })
    .from(runs)
    .innerJoin(installations, eq(installations.id, runs.installationId))
    .where(tenantScope(tenantId))
    .orderBy(desc(runs.startedAt))
    .limit(limit);

  return rows.map((r) => ({
    ...r,
    aiTokensUsed: r.aiTokensUsed ?? 0,
    aiMinutesUsed: r.aiMinutesUsed ?? 0,
    repoFullName: r.repoFullName ?? null,
  }));
}

/** Resolve a `range` query string into a Date lower-bound (or null). */
export function rangeToSince(range: string | undefined): Date | null {
  const now = Date.now();
  if (range === "7d") return new Date(now - 7 * 24 * 60 * 60 * 1000);
  if (range === "30d") return new Date(now - 30 * 24 * 60 * 60 * 1000);
  return null; // all-time
}

// Silence unused-import lint when inArray is not yet used in v1.
void inArray;
