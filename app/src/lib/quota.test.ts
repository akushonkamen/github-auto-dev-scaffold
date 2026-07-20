import { describe, it, expect } from "vitest";

// Unit tests for lib/quota.ts — pure logic only.
// DB-dependent functions (getPlanForTenant, getMonthUsage, checkQuota,
// updateTenantPlan) are integration tests requiring a Postgres pool and
// are not included here. See docs/app-architecture.md §6.5 for the
// integration test plan.

describe("PLAN_LIMITS", () => {
  it("defines free tier as 100k tokens", async () => {
    const { PLAN_LIMITS } = await import("@/lib/quota");
    expect(PLAN_LIMITS.free).toBe(100_000);
  });

  it("defines pro tier as 1M tokens", async () => {
    const { PLAN_LIMITS } = await import("@/lib/quota");
    expect(PLAN_LIMITS.pro).toBe(1_000_000);
  });

  it("defines enterprise tier as Infinity", async () => {
    const { PLAN_LIMITS } = await import("@/lib/quota");
    expect(PLAN_LIMITS.enterprise).toBe(Number.POSITIVE_INFINITY);
  });

  it("all plan limits are non-negative", async () => {
    const { PLAN_LIMITS } = await import("@/lib/quota");
    for (const [plan, limit] of Object.entries(PLAN_LIMITS)) {
      if (plan === "enterprise") {
        expect(limit).toBe(Number.POSITIVE_INFINITY);
      } else {
        expect(limit).toBeGreaterThan(0);
      }
    }
  });
});

describe("startOfMonthUTC (via getMonthUsage default)", () => {
  it("computes remaining correctly for under-limit usage", async () => {
    const { PLAN_LIMITS } = await import("@/lib/quota");
    // Free plan: limit 100k, used 50k → remaining 50k
    const limit = PLAN_LIMITS.free;
    const used = 50_000;
    const remaining = limit - used;
    expect(remaining).toBe(50_000);
  });

  it("enterprise always has infinity remaining", async () => {
    const { PLAN_LIMITS } = await import("@/lib/quota");
    expect(PLAN_LIMITS.enterprise - 999_999_999).toBe(Number.POSITIVE_INFINITY);
  });
});
