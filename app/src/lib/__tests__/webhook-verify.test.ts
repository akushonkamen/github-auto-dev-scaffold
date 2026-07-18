import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { verifyGitHubWebhookSignature } from "@/lib/webhook-verify";

function computeSignature(body: string, secret: string): string {
  const hmac = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return `sha256=${hmac}`;
}

describe("verifyGitHubWebhookSignature", () => {
  const secret = "itcher-woof-errand-folks-rarity";

  it("returns true for a valid signature", () => {
    const body = '{"action":"opened","issue":{"number":1}}';
    const sig = computeSignature(body, secret);
    expect(verifyGitHubWebhookSignature(body, sig, secret)).toBe(true);
  });

  it("returns false for an invalid signature", () => {
    const body = '{"action":"opened"}';
    const sig = "sha256=0000000000000000000000000000000000000000000000000000000000000000";
    expect(verifyGitHubWebhookSignature(body, sig, secret)).toBe(false);
  });

  it("returns false when signature header is null", () => {
    const body = '{"action":"opened"}';
    expect(verifyGitHubWebhookSignature(body, null, secret)).toBe(false);
  });

  it("returns false when signature header is undefined", () => {
    const body = '{"action":"opened"}';
    expect(verifyGitHubWebhookSignature(body, undefined, secret)).toBe(false);
  });

  it("returns false when signature header does not start with sha256=", () => {
    const body = '{"action":"opened"}';
    expect(verifyGitHubWebhookSignature(body, "sha1=abc123", secret)).toBe(false);
  });

  it("returns false when signature hex has invalid (non-hex) characters", () => {
    const body = '{"action":"opened"}';
    const sig = "sha256=zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz";
    expect(verifyGitHubWebhookSignature(body, sig, secret)).toBe(false);
  });

  it("returns false when signature hex has wrong length", () => {
    const body = '{"action":"opened"}';
    const sig = "sha256=abc";
    expect(verifyGitHubWebhookSignature(body, sig, secret)).toBe(false);
  });

  it("returns false for empty body with non-empty signature", () => {
    const sig = computeSignature('{"a":1}', secret);
    expect(verifyGitHubWebhookSignature("", sig, secret)).toBe(false);
  });

  it("returns false for tampered body (same secret, different content)", () => {
    const body = '{"action":"opened"}';
    const originalSig = computeSignature(body, secret);
    const tamperedBody = '{"action":"deleted"}';
    expect(verifyGitHubWebhookSignature(tamperedBody, originalSig, secret)).toBe(false);
  });

  it("returns false when using wrong secret", () => {
    const body = '{"action":"opened","issue":{"number":1}}';
    const sig = computeSignature(body, secret);
    expect(verifyGitHubWebhookSignature(body, sig, "wrong-secret")).toBe(false);
  });

  it("handles empty signature header string", () => {
    const body = '{"action":"opened"}';
    expect(verifyGitHubWebhookSignature(body, "", secret)).toBe(false);
  });

  it("handles empty secret (empty HMAC key)", () => {
    const body = '{"action":"opened"}';
    // With empty secret, compute the correct signature and verify it matches
    const sig = computeSignature(body, "");
    expect(verifyGitHubWebhookSignature(body, sig, "")).toBe(true);
  });

  it("handles empty body with matching signature", () => {
    const body = "";
    const sig = computeSignature(body, secret);
    expect(verifyGitHubWebhookSignature(body, sig, secret)).toBe(true);
  });

  it("verifies with unicode / multi-byte characters in body", () => {
    const body = JSON.stringify({ title: "héllo wörld 🔥" });
    const sig = computeSignature(body, secret);
    expect(verifyGitHubWebhookSignature(body, sig, secret)).toBe(true);
  });
});
