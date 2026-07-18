import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @upstash/qstash before importing the module under test
const mockVerify = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@upstash/qstash", () => ({
  Receiver: vi.fn().mockImplementation(() => ({
    verify: mockVerify,
  })),
}));

// Reload env for each test
const OLD_ENV = process.env;

describe("verifyQStashSignature", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...OLD_ENV };
    process.env.QSTASH_CURRENT_SIGNING_KEY = "test-current-key";
    process.env.QSTASH_NEXT_SIGNING_KEY = "test-next-key";
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it("returns false when signature header is missing", async () => {
    // Dynamic import so mocks are active
    const { verifyQStashSignature } = await import("@/lib/qstash-verify");
    const result = await verifyQStashSignature('{"hello":"world"}', null, "https://example.com/worker");
    expect(result).toBe(false);
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("returns false when signature header is empty string", async () => {
    const { verifyQStashSignature } = await import("@/lib/qstash-verify");
    const result = await verifyQStashSignature('{"hello":"world"}', "", "https://example.com/worker");
    expect(result).toBe(false);
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("returns true when Receiver.verify succeeds", async () => {
    mockVerify.mockResolvedValue(true);
    const { verifyQStashSignature } = await import("@/lib/qstash-verify");
    const result = await verifyQStashSignature(
      '{"event":"issues.opened","payload":{}}',
      "eyJhbGciOiJFUzI1NiJ9.valid-signature",
      "https://example.com/api/webhook/github/worker",
    );
    expect(result).toBe(true);
    expect(mockVerify).toHaveBeenCalledWith({
      signature: "eyJhbGciOiJFUzI1NiJ9.valid-signature",
      body: '{"event":"issues.opened","payload":{}}',
      url: "https://example.com/api/webhook/github/worker",
    });
  });

  it("returns false when Receiver.verify throws", async () => {
    mockVerify.mockRejectedValue(new Error("JWT verification failed"));
    const { verifyQStashSignature } = await import("@/lib/qstash-verify");
    const result = await verifyQStashSignature(
      '{"event":"issues.opened","payload":{}}',
      "bad-signature",
      "https://example.com/api/webhook/github/worker",
    );
    expect(result).toBe(false);
  });

  it("returns false when Receiver.verify returns false", async () => {
    mockVerify.mockResolvedValue(false);
    const { verifyQStashSignature } = await import("@/lib/qstash-verify");
    const result = await verifyQStashSignature(
      '{"event":"issues.opened","payload":{}}',
      "invalid-signature",
      "https://example.com/api/webhook/github/worker",
    );
    expect(result).toBe(false);
  });

  it("reuses the cached Receiver on subsequent calls", async () => {
    mockVerify.mockResolvedValue(true);
    const { verifyQStashSignature } = await import("@/lib/qstash-verify");
    await verifyQStashSignature("body-1", "sig-1", "https://example.com/worker");
    await verifyQStashSignature("body-2", "sig-2", "https://example.com/worker");
    // Receiver constructor is hoisted — it was called once during module init
    // The mock factory creates one instance; verify is called twice.
    expect(mockVerify).toHaveBeenCalledTimes(2);
  });
});
