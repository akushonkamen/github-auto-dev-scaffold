import "server-only";
import { Receiver } from "@upstash/qstash";

/**
 * Verify the `upstash-signature` header QStash attaches to every delivery.
 *
 * QStash signs the **raw** body with Ed25519 using the signing keys from the
 * Upstash console (NOT the QSTASH_TOKEN — that's the publish-side credential).
 * @upstash/qstash's Receiver tries `currentSigningKey` first, then falls back
 * to `nextSigningKey` (so key rotation works transparently).
 *
 * Caller responsibilities (PRD §7 S4):
 *  - Pass the **raw** body string (the bytes QStash delivered).
 *  - Never log `signature`, signing keys, or token values.
 */
let cachedReceiver: Receiver | null = null;

function getReceiver(): Receiver {
  if (cachedReceiver) return cachedReceiver;
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!currentSigningKey || !nextSigningKey) {
    throw new Error(
      "QSTASH_CURRENT_SIGNING_KEY / QSTASH_NEXT_SIGNING_KEY are not configured",
    );
  }
  cachedReceiver = new Receiver({ currentSigningKey, nextSigningKey });
  return cachedReceiver;
}

export async function verifyQStashSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  url: string,
): Promise<boolean> {
  if (!signatureHeader) return false;
  try {
    return await getReceiver().verify({
      signature: signatureHeader,
      body: rawBody,
      url,
    });
  } catch {
    // Receiver.verify throws on malformed JWT or bad signature — treat any
    // exception as verification failure.
    return false;
  }
}
