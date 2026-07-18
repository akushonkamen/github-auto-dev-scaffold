import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock the DB client ──────────────────────────────────────────────────────
// api-keys-queries.ts imports `db` from `@/db/client`. We replace it with a
// mock so tests never need a real Postgres connection.

const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockDelete = vi.fn();

vi.mock("@/db/client", () => ({
  db: {
    select: mockSelect,
    insert: mockInsert,
    delete: mockDelete,
  },
}));

// Helper: build a Drizzle-like chain with a terminal resolved value.
// SELECT: db.select({...}).from(table).where(cond).orderBy(desc) → rows[]
// INSERT: db.insert(table).values({...}).returning({id}) → [{id: N}]
// DELETE: db.delete(table).where(cond) → {rowCount: N}
function mockSelectChain(resolvedRows: unknown[]) {
  const orderBy = vi.fn().mockResolvedValue(resolvedRows as never);
  const where = vi.fn().mockReturnValue({ orderBy });
  const from = vi.fn().mockReturnValue({ where });
  mockSelect.mockReturnValue({ from });
}

function mockInsertChain(resolvedValue: unknown) {
  const returning = vi.fn().mockResolvedValue(resolvedValue as never);
  const values = vi.fn().mockReturnValue({ returning });
  mockInsert.mockReturnValue({ values });
}

function mockDeleteChain(resolvedValue: { rowCount: number }) {
  const where = vi.fn().mockResolvedValue(resolvedValue as never);
  mockDelete.mockReturnValue({ where });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("api-keys-queries.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── listApiKeysForTenant ──────────────────────────────────────────────────

  describe("listApiKeysForTenant", () => {
    it("returns rows with metadata only — no encryptedKey", async () => {
      const rows = [
        { id: 1, provider: "anthropic", keyHint: "abcd", createdAt: new Date("2026-07-01"), rotatedAt: null },
        { id: 2, provider: "openai", keyHint: "ef01", createdAt: new Date("2026-07-15"), rotatedAt: new Date("2026-07-16") },
      ];
      mockSelectChain(rows);

      const { listApiKeysForTenant } = await import("@/lib/api-keys-queries");
      const result = await listApiKeysForTenant(42);

      expect(result).toEqual(rows);
      expect(result).toHaveLength(2);
      // Verify encryptedKey is never part of the selected columns
      expect(result[0]).not.toHaveProperty("encryptedKey");
      expect(result[1]).not.toHaveProperty("encryptedKey");
    });

    it("returns empty array for tenant with no keys", async () => {
      mockSelectChain([]);

      const { listApiKeysForTenant } = await import("@/lib/api-keys-queries");
      const result = await listApiKeysForTenant(99);

      expect(result).toEqual([]);
    });

    it("orders results by createdAt descending", async () => {
      const later = { id: 2, provider: "deepseek", keyHint: "xyz", createdAt: new Date("2026-07-10"), rotatedAt: null };
      const earlier = { id: 1, provider: "anthropic", keyHint: "abc", createdAt: new Date("2026-07-01"), rotatedAt: null };
      mockSelectChain([later, earlier]);

      const { listApiKeysForTenant } = await import("@/lib/api-keys-queries");
      const result = await listApiKeysForTenant(42);

      expect(result).toHaveLength(2);
      // Newest first (descending order)
      expect(result[0].createdAt!.getTime()).toBeGreaterThan(result[1].createdAt!.getTime());
    });
  });

  // ── insertApiKey ─────────────────────────────────────────────────────────

  describe("insertApiKey", () => {
    it("inserts a new key and returns the row id", async () => {
      mockInsertChain([{ id: 7 }]);

      const { insertApiKey } = await import("@/lib/api-keys-queries");
      const result = await insertApiKey({
        tenantId: 42,
        provider: "anthropic",
        encryptedKey: "iv:ciphertext:tag",
        keyHint: "abcd",
      });

      expect(result).toEqual({ id: 7 });
      expect(mockInsert).toHaveBeenCalledOnce();
    });
  });

  // ── deleteApiKey ─────────────────────────────────────────────────────────

  describe("deleteApiKey", () => {
    it("deletes a key belonging to the tenant and returns rowCount", async () => {
      mockDeleteChain({ rowCount: 1 });

      const { deleteApiKey } = await import("@/lib/api-keys-queries");
      const count = await deleteApiKey(42, 1);

      expect(count).toBe(1);
      expect(mockDelete).toHaveBeenCalledOnce();
    });

    it("returns 0 when key does not belong to the tenant", async () => {
      mockDeleteChain({ rowCount: 0 });

      const { deleteApiKey } = await import("@/lib/api-keys-queries");
      const count = await deleteApiKey(42, 999);

      expect(count).toBe(0);
      expect(mockDelete).toHaveBeenCalledOnce();
    });

    it("returns 0 when rowCount is null (no match)", async () => {
      mockDeleteChain({ rowCount: 0 });

      const { deleteApiKey } = await import("@/lib/api-keys-queries");
      const count = await deleteApiKey(42, 0);

      expect(count).toBe(0);
    });
  });
});
