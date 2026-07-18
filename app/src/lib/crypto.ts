import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM crypto helper for BYOK (Issue #8).
 *
 * Uses the `APP_BYOK_MASTER_KEY` environment variable, which must be a
 * 32-byte value encoded as base64. If the variable is missing or not
 * valid 32-byte base64, every call throws an error — never fall back to
 * a hardcoded key.
 *
 * Encrypt output format: `iv:cipherText:tag` — each segment is base64.
 * Decrypt expects the same format.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit IV is the GCM recommended default

function getMasterKey(): Buffer {
  const raw = process.env.APP_BYOK_MASTER_KEY;
  if (!raw) {
    throw new Error(
      "APP_BYOK_MASTER_KEY is not set — BYOK encryption is unavailable",
    );
  }

  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    throw new Error(
      "APP_BYOK_MASTER_KEY is not valid base64 — BYOK encryption is unavailable",
    );
  }

  if (key.length !== 32) {
    throw new Error(
      "APP_BYOK_MASTER_KEY must be a 32-byte value encoded as base64",
    );
  }

  return key;
}

/**
 * Encrypt `plaintext` (UTF-8 string) with AES-256-GCM.
 *
 * Returns `iv:cipherText:tag` where each segment is base64-encoded.
 * Never logs or echoes the plaintext (S4).
 */
export function encrypt(plaintext: string): string {
  const key = getMasterKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf-8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  const ivB64 = iv.toString("base64");
  const cipherB64 = encrypted.toString("base64");
  const tagB64 = tag.toString("base64");

  return `${ivB64}:${cipherB64}:${tagB64}`;
}

/**
 * Decrypt a combined `iv:cipherText:tag` string (each segment base64).
 *
 * Returns the original UTF-8 string. Throws on tampered ciphertext
 * (GCM authentication failure).
 */
export function decrypt(combined: string): string {
  const key = getMasterKey();

  const parts = combined.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted payload format");
  }

  const [ivB64, cipherB64, tagB64] = parts;

  const iv = Buffer.from(ivB64, "base64");
  const encrypted = Buffer.from(cipherB64, "base64");
  const tag = Buffer.from(tagB64, "base64");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString("utf-8");
}
