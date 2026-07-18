import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @upstash/redis
const mockSet = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@upstash/redis", () => ({
  Redis: vi.fn().mockImplementation(() => ({
    set: mockSet,
  })),
}));

const OLD_ENV = process.env;

describe("claimDelivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...OLD_ENV };
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it("returns true when SETNX succeeds (first claim)", async () => {
    mockSet.mockResolvedValue("OK");
    const { claimDelivery, getRedis } = await import("@/lib/redis");
    const result = await claimDelivery("delivery-uuid-123");
    expect(result).toBe(true);
    expect(mockSet).toHaveBeenCalledWith("delivery:delivery-uuid-123", "1", {
      nx: true,
      ex: 86400,
    });
  });

  it("returns false when SETNX returns null (already claimed)", async () => {
    mockSet.mockResolvedValue(null);
    const { claimDelivery } = await import("@/lib/redis");
    const result = await claimDelivery("delivery-uuid-456");
    expect(result).toBe(false);
  });

  it("throws when env vars are not configured", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    const { getRedis } = await import("@/lib/redis");
    expect(() => getRedis()).toThrow("UPSTASH_REDIS_REST_URL");
  });

  it("caches the Redis client on repeated calls", async () => {
    mockSet.mockResolvedValue("OK");
    const { claimDelivery } = await import("@/lib/redis");
    await claimDelivery("delivery-1");
    await claimDelivery("delivery-2");
    // Redis constructor should have been called only once (cached)
    const { Redis } = await import("@upstash/redis");
    expect(Redis).toHaveBeenCalledTimes(1);
  });
});
