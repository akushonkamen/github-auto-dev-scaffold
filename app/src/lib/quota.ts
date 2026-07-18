import "server-only";
import { and, eq, gte, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { installations, runs, tenants, usageLogs } from "@/db/schema";

export type Plan = "free" | "pro" | "enterprise";

export const PLAN_LIMITS: Record<Plan, number> = {
  free: 100_000,
  pro: 1_000_000,
  enterprise: Number.POSITIVE_INFINITY,
};

export interface QuotaStatus {
  allowed: boolean;
  plan: Plan;
  used: number;
  limit: number;
  remaining: number;
}

function startOfMonthUTC(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function normalizePlan(raw: string | null | undefined): Plan {
  if (raw === "pro" || raw === "enterprise") return raw;
  return "free";
}

/** Read the plan column for a tenant. Unknown / null → "free". */
export async function getPlanForTenant(tenantId: number): Promise<Plan> {
  const rows = await db
    .select({ plan: tenants.plan })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  return normalizePlan(rows[0]?.plan);
}

/**
 * Sum input+output tokens for the tenant in the current calendar month
 * (UTC). Joins usage_logs → runs → installations so every row is scoped
 * by `installations.tenant_id`.
 */
export async function getMonthUsage(
  tenantId: number,
  now = new Date(),
): Promise<number> {
  const since = startOfMonthUTC(now);
  const row = await db
    .select({
      total: sql<number>`coalesce(sum(${usageLogs.inputTokens} + ${usageLogs.outputTokens}), 0)`.as("total"),
    })
    .from(usageLogs)
    .innerJoin(runs, eq(runs.id, usageLogs.runId))
    .innerJoin(installations, eq(installations.id, runs.installationId))
    .where(and(eq(installations.tenantId, tenantId), gte(usageLogs.calledAt, since)));
  return Number(row[0]?.total ?? 0);
}

/**
 * Decide whether a new dispatch is allowed under the tenant's plan.
 * `allowed=false` means the worker should refuse the dispatch and mark
 * the run `failed` without retrying (Free tier exhausted).
 */
export async function checkQuota(
  tenantId: number,
  now = new Date(),
): Promise<QuotaStatus> {
  const plan = await getPlanForTenant(tenantId);
  const limit = PLAN_LIMITS[plan];
  const used = await getMonthUsage(tenantId, now);
  const remaining = limit === Number.POSITIVE_INFINITY ? Infinity : Math.max(0, limit - used);
  return {
    allowed: used < limit,
    plan,
    used,
    limit,
    remaining,
  };
}

/** Update plan + Stripe customer id for a tenant. Idempotent. */
export async function updateTenantPlan(
  tenantId: number,
  plan: Plan,
  stripeCustomerId: string | null,
): Promise<void> {
  await db
    .update(tenants)
    .set({ plan, stripeCustomerId })
    .where(eq(tenants.id, tenantId));
}
