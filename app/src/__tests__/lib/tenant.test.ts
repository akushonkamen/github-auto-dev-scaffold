import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock the DB client ──────────────────────────────────────────────────────
// tenant.ts imports `db` from `@/db/client`. We mock it so tests never
// need a real Postgres connection.

const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockLimit = vi.fn();

vi.mock("@/db/client", () => ({
  db: {
    select: mockSelect,
  },
}));

// Drizzle query chain: db.select({...}).from(table).where(cond).limit(1)
// Each method returns `this` (the query builder) except `.limit()` which
// returns a Promise that resolves to the rows array.
function mockSelectChain(resolvedRows: unknown[]) {
  mockSelect.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(resolvedRows as never),
      }),
    }),
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("tenant.ts — getTenantIdForSessionUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns tenant id when session has a valid githubId", async () => {
    mockSelectChain([{ id: 42 }]);

    const { getTenantIdForSessionUser } = await import("@/lib/tenant");
    const session = {
      user: { githubId: 12345, name: "testuser" },
      expires: "2099-01-01",
    };

    const result = await getTenantIdForSessionUser(session);

    expect(result).toBe(42);
  });

  it("returns null when session.user has no githubId", async () => {
    const { getTenantIdForSessionUser } = await import("@/lib/tenant");
    const session = {
      user: { name: "testuser" },
      expires: "2099-01-01",
    };

    const result = await getTenantIdForSessionUser(session);

    expect(result).toBeNull();
    // DB should NOT have been called when githubId is missing
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("returns null when session.user is undefined", async () => {
    const { getTenantIdForSessionUser } = await import("@/lib/tenant");
    const session = {
      expires: "2099-01-01",
    };

    const result = await getTenantIdForSessionUser(session);

    expect(result).toBeNull();
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("returns null when DB returns no matching tenant", async () => {
    mockSelectChain([]);

    const { getTenantIdForSessionUser } = await import("@/lib/tenant");
    const session = {
      user: { githubId: 99999 },
      expires: "2099-01-01",
    };

    const result = await getTenantIdForSessionUser(session);

    expect(result).toBeNull();
  });
});
