import { describe, it, expect } from "vitest";

// Unit tests for lib/usage-queries.ts — pure logic only.
// DB-dependent functions (getUsageSummary, getUsageByStage, getUsageByModel,
// getRecentRunsForTenant) are integration tests requiring a Postgres pool
// and are not included here. See docs/app-architecture.md §6.4 for the
// integration test plan.

describe("rangeToSince", () => {
  it("returns a Date 7 days ago for '7d'", async () => {
    const { rangeToSince } = await import("@/lib/usage-queries");
    const result = rangeToSince("7d");
    expect(result).toBeInstanceOf(Date);
    const expected = Date.now() - 7 * 24 * 60 * 60 * 1000;
    // Allow 5s clock skew
    expect(Math.abs(result!.getTime() - expected)).toBeLessThan(5000);
  });

  it("returns a Date 30 days ago for '30d'", async () => {
    const { rangeToSince } = await import("@/lib/usage-queries");
    const result = rangeToSince("30d");
    expect(result).toBeInstanceOf(Date);
    const expected = Date.now() - 30 * 24 * 60 * 60 * 1000;
    expect(Math.abs(result!.getTime() - expected)).toBeLessThan(5000);
  });

  it("returns null for 'all' (no bounds)", async () => {
    const { rangeToSince } = await import("@/lib/usage-queries");
    expect(rangeToSince("all")).toBeNull();
  });

  it("returns null for undefined (all-time default)", async () => {
    const { rangeToSince } = await import("@/lib/usage-queries");
    expect(rangeToSince(undefined)).toBeNull();
  });

  it("returns null for unrecognized range string", async () => {
    const { rangeToSince } = await import("@/lib/usage-queries");
    expect(rangeToSince("invalid")).toBeNull();
  });

  it("returns null for empty string", async () => {
    const { rangeToSince } = await import("@/lib/usage-queries");
    expect(rangeToSince("")).toBeNull();
  });
});

describe("return types (compile-time shape check)", () => {
  it("UsageSummary shape has the expected numeric fields", async () => {
    const summary: import("@/lib/usage-queries").UsageSummary = {
      totalTokens: 1000,
      totalCostUsd: 0.05,
      totalMinutes: 2.5,
      totalRuns: 10,
    };
    expect(typeof summary.totalTokens).toBe("number");
    expect(typeof summary.totalCostUsd).toBe("number");
    expect(typeof summary.totalMinutes).toBe("number");
    expect(typeof summary.totalRuns).toBe("number");
  });

  it("StageBreakdown shape has the expected fields", async () => {
    const stage: import("@/lib/usage-queries").StageBreakdown = {
      stage: "test",
      totalTokens: 500,
      totalCostUsd: 0.02,
      calls: 3,
    };
    expect(typeof stage.stage).toBe("string");
    expect(typeof stage.totalTokens).toBe("number");
    expect(typeof stage.totalCostUsd).toBe("number");
    expect(typeof stage.calls).toBe("number");
  });

  it("ModelBreakdown shape has the expected fields", async () => {
    const model: import("@/lib/usage-queries").ModelBreakdown = {
      model: "claude-sonnet-4-6",
      totalTokens: 800,
      totalCostUsd: 0.03,
      calls: 2,
    };
    expect(typeof model.model).toBe("string");
    expect(typeof model.totalTokens).toBe("number");
    expect(typeof model.totalCostUsd).toBe("number");
    expect(typeof model.calls).toBe("number");
  });

  it("RecentRunRow shape has the expected fields", async () => {
    const run: import("@/lib/usage-queries").RecentRunRow = {
      id: 1,
      installationId: 1,
      installationGithubId: 12345,
      repoFullName: "owner/repo",
      issueNumber: 42,
      prNumber: null,
      currentStage: "test",
      status: "merged",
      aiTokensUsed: 1000,
      aiMinutesUsed: 5.0,
      startedAt: new Date(),
    };
    expect(run.id).toBe(1);
    expect(run.issueNumber).toBe(42);
    expect(run.repoFullName).toBe("owner/repo");
  });
});
