import { describe, it, expect, vi, beforeEach } from "vitest";

const mockInsert = vi.fn();
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockLimit = vi.fn();
const mockOnConflictDoUpdate = vi.fn();

// Mock the db client
vi.mock("@/db/client", () => ({
  db: {
    insert: mockInsert,
    select: mockSelect,
  },
}));

describe("upsertRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsert.mockReturnThis();
    mockSelect.mockReturnThis();
    mockFrom.mockReturnThis();
    mockWhere.mockReturnThis();
    mockLimit.mockReturnThis();
    mockOnConflictDoUpdate.mockReturnThis();
  });

  it("inserts a run and returns its id", async () => {
    mockInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 1 }]),
        }),
      }),
    });

    const { upsertRun } = await import("@/lib/runs");
    const result = await upsertRun({
      installationDbId: 42,
      issueNumber: 7,
      currentStage: "issues.opened",
      status: "dispatching",
    });

    expect(result).toEqual({ runId: 1 });
    expect(mockInsert).toHaveBeenCalled();
  });

  it("uses onConflictDoUpdate for idempotent upsert", async () => {
    const returningMock = vi.fn().mockResolvedValue([{ id: 2 }]);
    const onConflictDoUpdateMock = vi.fn().mockReturnValue({
      returning: returningMock,
    });
    mockInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: onConflictDoUpdateMock,
      }),
    });

    const { upsertRun } = await import("@/lib/runs");
    await upsertRun({
      installationDbId: 42,
      issueNumber: 7,
      currentStage: "issues.labeled",
      status: "dispatched",
    });

    expect(onConflictDoUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        target: expect.any(Array),
        set: expect.objectContaining({
          currentStage: "issues.labeled",
          status: "dispatched",
        }),
      }),
    );
  });

  it("inserts with optional prNumber", async () => {
    mockInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 3 }]),
        }),
      }),
    });

    const { upsertRun } = await import("@/lib/runs");
    const result = await upsertRun({
      installationDbId: 1,
      issueNumber: 99,
      prNumber: 88,
      currentStage: "pull_request.opened",
      status: "dispatching",
    });

    expect(result).toEqual({ runId: 3 });
  });

  it("returns runId 0 if insert returns empty", async () => {
    mockInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

    const { upsertRun } = await import("@/lib/runs");
    const result = await upsertRun({
      installationDbId: 999,
      issueNumber: 0,
      currentStage: "test.stage",
      status: "dispatching",
    });

    expect(result).toEqual({ runId: 0 });
  });
});

describe("findRunByIssue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelect.mockReturnThis();
    mockFrom.mockReturnThis();
    mockWhere.mockReturnThis();
    mockLimit.mockReturnThis();
  });

  it("returns run id when found", async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ id: 1 }]),
        }),
      }),
    });

    const { findRunByIssue } = await import("@/lib/runs");
    const result = await findRunByIssue(42, 7);
    expect(result).toEqual({ id: 1 });
  });

  it("returns null when not found", async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

    const { findRunByIssue } = await import("@/lib/runs");
    const result = await findRunByIssue(42, 999);
    expect(result).toBeNull();
  });
});
