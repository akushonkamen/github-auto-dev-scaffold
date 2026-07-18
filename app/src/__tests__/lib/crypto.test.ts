import { describe, it, expect, beforeEach, afterEach } from "vitest";

// ── Helper: generate a valid 32-byte base64 master key ──────────────────────
function validB64Key(): string {
  // 32 zero bytes encoded as base64 (static, always valid)
  return Buffer.from(new Uint8Array(32)).toString("base64");
}

// ── Test suite ──────────────────────────────────────────────────────────────

describe("crypto.ts — AES-256-GCM BYOK helper", () => {
  const ORIGINAL_KEY = process.env.APP_BYOK_MASTER_KEY;

  beforeEach(() => {
    // Clear env before each test; each test sets its own.
    delete process.env.APP_BYOK_MASTER_KEY;
  });

  afterEach(() => {
    // Restore original (in case of --watch).
    process.env.APP_BYOK_MASTER_KEY = ORIGINAL_KEY;
  });

  // ── encrypt() ──────────────────────────────────────────────────────────────

  describe("encrypt()", () => {
    it("throws when APP_BYOK_MASTER_KEY is not set", async () => {
      const { encrypt } = await import("@/lib/crypto");
      expect(() => encrypt("hello")).toThrow("APP_BYOK_MASTER_KEY is not set");
    });

    it("throws when key is not valid base64", async () => {
      process.env.APP_BYOK_MASTER_KEY = "not-base64-!!!";
      const { encrypt } = await import("@/lib/crypto");
      // Module caches `getMasterKey` results because it's called inside each
      // function call — but `getMasterKey` reads process.env each time.
      expect(() => encrypt("hello")).toThrow("BYOK encryption is unavailable");
    });

    it("throws when key is not 32 bytes", async () => {
      // "aGVsbG8=" = "hello" = 5 bytes, base64-encoded
      process.env.APP_BYOK_MASTER_KEY = "aGVsbG8=";
      const { encrypt } = await import("@/lib/crypto");
      expect(() => encrypt("hello")).toThrow("must be a 32-byte value");
    });

    it("returns iv:cipherText:tag format with base64 segments", async () => {
      process.env.APP_BYOK_MASTER_KEY = validB64Key();
      const { encrypt } = await import("@/lib/crypto");

      const result = encrypt("my-api-key");
      const parts = result.split(":");

      expect(parts).toHaveLength(3);
      // Each part should be valid base64
      for (const part of parts) {
        expect(() => Buffer.from(part, "base64")).not.toThrow();
        expect(Buffer.from(part, "base64").length).toBeGreaterThan(0);
      }
    });

    it("produces different ciphertext for same plaintext (random IV)", async () => {
      process.env.APP_BYOK_MASTER_KEY = validB64Key();
      const { encrypt } = await import("@/lib/crypto");

      const a = encrypt("same-value");
      const b = encrypt("same-value");
      expect(a).not.toBe(b);
    });
  });

  // ── decrypt() ──────────────────────────────────────────────────────────────

  describe("decrypt()", () => {
    it("returns original plaintext for a valid encrypted string", async () => {
      process.env.APP_BYOK_MASTER_KEY = validB64Key();
      const { encrypt, decrypt } = await import("@/lib/crypto");

      const plaintext = "sk-ant-my-test-key-12345";
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);

      expect(decrypted).toBe(plaintext);
    });

    it("throws on tampered ciphertext (GCM auth failure)", async () => {
      process.env.APP_BYOK_MASTER_KEY = validB64Key();
      const { encrypt, decrypt } = await import("@/lib/crypto");

      const encrypted = encrypt("some-key");
      // Tamper with the cipherText segment (middle)
      const parts = encrypted.split(":");
      parts[1] = Buffer.from("tampered").toString("base64");
      const tampered = parts.join(":");

      expect(() => decrypt(tampered)).toThrow();
    });

    it("throws on invalid format (wrong number of parts)", async () => {
      process.env.APP_BYOK_MASTER_KEY = validB64Key();
      const { decrypt } = await import("@/lib/crypto");

      expect(() => decrypt("just-one-part")).toThrow("Invalid encrypted payload format");
      expect(() => decrypt("a:b:c:d")).toThrow("Invalid encrypted payload format");
    });

    it("throws on malformed base64 in segments", async () => {
      process.env.APP_BYOK_MASTER_KEY = validB64Key();
      const { decrypt } = await import("@/lib/crypto");

      expect(() => decrypt("!!!:!!!:!!!")).toThrow();
    });
  });

  // ── Round-trip ─────────────────────────────────────────────────────────────

  describe("round-trip", () => {
    it("encrypt followed by decrypt returns original for various inputs", async () => {
      process.env.APP_BYOK_MASTER_KEY = validB64Key();
      const { encrypt, decrypt } = await import("@/lib/crypto");

      const testCases = [
        "",
        "a",
        "sk-ant-some-long-key-0123456789abcdef",
        "openai-key-with-special-chars-!@#$%^&*()",
        "deepseek-ds-abc123",
        "custom-org-key-🚀-emoji-test",
      ];

      for (const tc of testCases) {
        const encrypted = encrypt(tc);
        const decrypted = decrypt(encrypted);
        expect(decrypted).toBe(tc);
      }
    });
  });
});
