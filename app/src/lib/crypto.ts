import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM encrypt/decrypt for BYOK rows (Issue #8).
 *
 * Master key MUST be 32 bytes raw, supplied via APP_BYOK_MASTER_KEY env as
 * base64 (44 chars, no padding). We refuse to operate if the env is missing
 * or malformed — never fall back to a hardcoded key (S4 red line).
 *
 * Cipher format: `${ivBase64}:${cipherTextBase64}:${tagBase64}` — single
 * string stored in `api_keys.encrypted_key`. iv is 12 bytes (GCM standard),
 * tag is 16 bytes.
 */

const KEY_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;

let cachedKey: Buffer | null = null;
let keyError: Error | null = null;

function getMasterKey(): Buffer {
  if (cachedKey) return cachedKey;
  if (keyError) throw keyError;

  const raw = process.env.APP_BYOK_MASTER_KEY;
  if (!raw) {
    keyError = new Error("APP_BYOK_MASTER_KEY missing");
    throw keyError;
  }

  let buf: Buffer;
  try {
    buf = Buffer.from(raw, "base64");
  } catch {
    keyError = new Error("APP_BYOK_MASTER_KEY malformed");
    throw keyError;
  }
  if (buf.length !== KEY_LEN) {
    keyError = new Error("APP_BYOK_MASTER_KEY wrong length");
    throw keyError;
  }

  cachedKey = buf;
  return buf;
}

export function encryptKey(plaintext: string): string {
  if (!plaintext) throw new Error("plaintext required");
  const key = getMasterKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, enc, tag].map((b) => b.toString("base64")).join(":");
}

export function decryptKey(stored: string): string {
  if (!stored) throw new Error("stored required");
  const key = getMasterKey();
  const parts = stored.split(":");
  if (parts.length !== 3) throw new Error("ciphertext malformed");
  const [ivB64, ctB64, tagB64] = parts;
  let iv: Buffer, ct: Buffer, tag: Buffer;
  try {
    iv = Buffer.from(ivB64, "base64");
    ct = Buffer.from(ctB64, "base64");
    tag = Buffer.from(tagB64, "base64");
  } catch {
    throw new Error("ciphertext malformed");
  }
  if (iv.length !== IV_LEN || tag.length !== TAG_LEN) {
    throw new Error("ciphertext malformed");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(ct), decipher.final()]);
  return dec.toString("utf8");
}

/** Last-4 hint for UI display. Never returns the full key. */
export function keyHint(plaintext: string): string {
  if (!plaintext) return "";
  return plaintext.length <= 4
    ? "•".repeat(plaintext.length)
    : plaintext.slice(-4);
}
