import { describe, it, expect } from "vitest";
import { verifyGitHubWebhookSignature } from "@/lib/webhook-verify";

describe("verifyGitHubWebhookSignature", () => {
  const secret = "test-secret";
  // Pre-computed: HMAC-SHA256("test-secret", '{"hello":"world"}') = ...
  // We'll compute inline to be sure

  function expectedHmac(body: string, key: string): string {
    const crypto = require("node:crypto");
    return crypto.createHmac("sha256", key).update(body).digest("hex");
  }

  it("returns true for a valid signature", () => {
    const body = '{"hello":"world"}';
    const hmac = expectedHmac(body, secret);
    const result = verifyGitHubWebhookSignature(body, `sha256=${hmac}`, secret);
    expect(result).toBe(true);
  });

  it("returns false when signature header is missing", () => {
    const result = verifyGitHubWebhookSignature('{"hello":"world"}', null, secret);
    expect(result).toBe(false);
  });

  it("returns false when signature header is empty", () => {
    const result = verifyGitHubWebhookSignature('{"hello":"world"}', "", secret);
    expect(result).toBe(false);
  });

  it("returns false when signature does not start with sha256=", () => {
    const result = verifyGitHubWebhookSignature('{"hello":"world"}', "hmac=abc123", secret);
    expect(result).toBe(false);
  });

  it("returns false when signature does not match", () => {
    const result = verifyGitHubWebhookSignature(
      '{"hello":"world"}',
      "sha256=0000000000000000000000000000000000000000000000000000000000000000",
      secret,
    );
    expect(result).toBe(false);
  });

  it("returns false when body does not match signature", () => {
    const body = '{"hello":"world"}';
    const hmac = expectedHmac(body, secret);
    const result = verifyGitHubWebhookSignature(
      '{"hello":"different"}',
      `sha256=${hmac}`,
      secret,
    );
    expect(result).toBe(false);
  });

  it("returns false when secret does not match (wrong key)", () => {
    const body = '{"hello":"world"}';
    const hmac = expectedHmac(body, "different-secret");
    const result = verifyGitHubWebhookSignature(
      body,
      `sha256=${hmac}`,
      secret, // our secret is "test-secret", not "different-secret"
    );
    expect(result).toBe(false);
  });

  it("returns false on non-hex signature (length mismatch)", () => {
    const result = verifyGitHubWebhookSignature(
      '{"hello":"world"}',
      "sha256=xyz",
      secret,
    );
    expect(result).toBe(false);
  });
});
