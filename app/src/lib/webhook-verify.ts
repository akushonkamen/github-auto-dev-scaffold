import "server-only";
import crypto from "node:crypto";

/**
 * Verify the X-Hub-Signature-256 header GitHub sends on every webhook.
 *
 * GitHub signs the **raw** request body with HMAC-SHA256 using the
 * WEBHOOK_SECRET configured on the GitHub App. We must compare with
 * `timingSafeEqual` to prevent timing-channel attacks (PRD §6 S10).
 *
 * Caller responsibilities:
 *  - Pass the **raw** body (the bytes received from the network), not
 *    a re-serialized JSON object. `request.text()` is correct; `.json()`
 *    is not — round-tripping through JSON can change whitespace and
 *    invalidate the signature.
 *  - Never log `secret`, `expected`, or `hmac` values (PRD §7 S4).
 *
 * @returns true iff the signature header is well-formed AND matches the
 *          HMAC of `rawBody` under `secret`.
 */
export function verifyGitHubWebhookSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret: string,
): boolean {
  if (!signatureHeader) return false;
  if (!signatureHeader.startsWith("sha256=")) return false;

  const expected = signatureHeader.slice("sha256=".length);
  const hmac = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(hmac, "hex");
  // Buffer.from(...) returns an empty buffer when the input is not valid
  // hex; a length mismatch (or empty buffer) means we never call
  // timingSafeEqual with mismatched lengths (which would throw).
  if (a.length !== b.length || a.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
}
