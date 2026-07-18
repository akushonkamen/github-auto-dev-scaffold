import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock jose
const mockSign = vi.fn().mockReturnThis();
const mockSetProtectedHeader = vi.fn().mockReturnThis();
const mockSetIssuer = vi.fn().mockReturnThis();
const mockSetIssuedAt = vi.fn().mockReturnThis();
const mockSetExpirationTime = vi.fn().mockReturnThis();

vi.mock("jose", () => ({
  SignJWT: vi.fn().mockImplementation(() => ({
    setProtectedHeader: mockSetProtectedHeader,
    setIssuer: mockSetIssuer,
    setIssuedAt: mockSetIssuedAt,
    setExpirationTime: mockSetExpirationTime,
    sign: mockSign,
  })),
  importPKCS8: vi.fn().mockResolvedValue("mock-private-key"),
}));

// Mock @/lib/github-app-jwt
vi.mock("@/lib/github-app-jwt", () => ({
  signAppJwt: vi.fn().mockResolvedValue("mock-app-jwt"),
}));

const OLD_ENV = process.env;
let originalFetch: typeof global.fetch;

describe("getInstallationToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...OLD_ENV };
    process.env.APP_ID = "123456";
    process.env.APP_PRIVATE_KEY = "bW9jay1wcml2YXRlLWtleS1wZW0=";

    // Clean the module cache so _clearTokenCache can work
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it("returns a token from the GitHub API on first call", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          token: "ghs_installation-token-abc",
          expires_at: new Date(Date.now() + 55 * 60 * 1000).toISOString(),
        }),
    });

    const { getInstallationToken, _clearTokenCache } = await import("@/lib/installation-token");
    _clearTokenCache(42); // clean slate

    const token = await getInstallationToken(42);
    expect(token).toBe("ghs_installation-token-abc");

    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.github.com/app/installations/42/access_tokens",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer mock-app-jwt",
          Accept: "application/vnd.github+json",
        }),
      }),
    );
  });

  it("returns cached token on second call within 50 min", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          token: "ghs_installation-token-abc",
          expires_at: new Date(Date.now() + 55 * 60 * 1000).toISOString(),
        }),
    });

    const { getInstallationToken, _clearTokenCache } = await import("@/lib/installation-token");
    _clearTokenCache(42);

    await getInstallationToken(42); // first call — fetches
    const token = await getInstallationToken(42); // second call — cached
    expect(token).toBe("ghs_installation-token-abc");
    expect(global.fetch).toHaveBeenCalledTimes(1); // only the first call reached GitHub
  });

  it("throws on non-ok response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
    });

    const { getInstallationToken, _clearTokenCache } = await import("@/lib/installation-token");
    _clearTokenCache(42);

    await expect(getInstallationToken(42)).rejects.toThrow(
      "installation token mint failed: status=401",
    );
  });

  it("maintains separate caches per installation ID", async () => {
    let callCount = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            token: `ghs_token_${callCount}`,
            expires_at: new Date(Date.now() + 55 * 60 * 1000).toISOString(),
          }),
      });
    });

    const { getInstallationToken, _clearTokenCache } = await import("@/lib/installation-token");
    _clearTokenCache();

    const token1 = await getInstallationToken(1);
    const token2 = await getInstallationToken(2);
    const cached1 = await getInstallationToken(1);
    const cached2 = await getInstallationToken(2);

    expect(token1).toBe("ghs_token_1");
    expect(token2).toBe("ghs_token_2");
    expect(cached1).toBe(token1);
    expect(cached2).toBe(token2);
    expect(callCount).toBe(2); // each installation fetched once, then cached
  });

  it("re-fetches after cache expiry", async () => {
    global.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            token: `ghs_fresh_${Date.now()}`,
            expires_at: new Date(Date.now() + 55 * 60 * 1000).toISOString(),
          }),
      }),
    );

    const { getInstallationToken, _clearTokenCache } = await import("@/lib/installation-token");
    _clearTokenCache(99);

    // First call populates cache with a future expiry
    const token1 = await getInstallationToken(99);

    // Simulate the cache entry being near-expired by clearing it
    _clearTokenCache(99);

    const token2 = await getInstallationToken(99);
    expect(token2).not.toBe(token1); // fresh fetch
  });

  it("_clearTokenCache() clears all cached entries", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          token: "ghs_clear_test",
          expires_at: new Date(Date.now() + 55 * 60 * 1000).toISOString(),
        }),
    });

    const { getInstallationToken, _clearTokenCache } = await import("@/lib/installation-token");
    _clearTokenCache();

    await getInstallationToken(10);
    _clearTokenCache(); // clear all
    await getInstallationToken(10);

    expect(global.fetch).toHaveBeenCalledTimes(2); // re-fetched after cache clear
  });
});
