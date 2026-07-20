import "server-only";
import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { apiKeys } from "@/db/schema";

export interface ApiKeyRowPublic {
  id: number;
  provider: string;
  keyHint: string | null;
  createdAt: Date | null;
  rotatedAt: Date | null;
}

/**
 * List BYOK rows for a tenant. The encrypted blob is never returned —
 * only the public hint fields. This is the only safe shape to send to the
 * browser or to log.
 */
export async function listApiKeysForTenant(
  tenantId: number,
): Promise<ApiKeyRowPublic[]> {
  const rows = await db
    .select({
      id: apiKeys.id,
      provider: apiKeys.provider,
      keyHint: apiKeys.keyHint,
      createdAt: apiKeys.createdAt,
      rotatedAt: apiKeys.rotatedAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.tenantId, tenantId))
    .orderBy(desc(apiKeys.createdAt));
  return rows;
}

export async function insertApiKey(input: {
  tenantId: number;
  provider: string;
  encryptedKey: string;
  keyHint: string | null;
}): Promise<{ id: number }> {
  const [row] = await db
    .insert(apiKeys)
    .values({
      tenantId: input.tenantId,
      provider: input.provider,
      encryptedKey: input.encryptedKey,
      keyHint: input.keyHint,
    })
    .returning({ id: apiKeys.id });
  if (!row) throw new Error("insert failed");
  return row;
}

/**
 * Delete scoped by both tenantId and id. Returns true if a row was deleted,
 * false otherwise — caller can map false to 404.
 */
export async function deleteApiKey(
  tenantId: number,
  id: number,
): Promise<boolean> {
  const result = await db
    .delete(apiKeys)
    .where(and(eq(apiKeys.id, id), eq(apiKeys.tenantId, tenantId)))
    .returning({ id: apiKeys.id });
  return result.length > 0;
}

/** Decrypt helper for internal callers (worker dispatch, usage audit). */
export async function getDecryptedKeyForTenant(
  tenantId: number,
  provider: string,
): Promise<string | null> {
  const rows = await db
    .select({ encryptedKey: apiKeys.encryptedKey })
    .from(apiKeys)
    .where(and(eq(apiKeys.tenantId, tenantId), eq(apiKeys.provider, provider)))
    .orderBy(desc(apiKeys.createdAt))
    .limit(1);
  if (!rows[0]) return null;
  const { decryptKey } = await import("@/lib/crypto");
  return decryptKey(rows[0].encryptedKey);
}
