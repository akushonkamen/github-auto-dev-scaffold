import "server-only";
import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { apiKeys } from "@/db/schema";

/**
 * DB queries for BYOK API key management (Issue #8).
 *
 * Every query is scoped by `tenantId` derived from the session — never
 * accept a tenant id from client input (security constraint).
 */

export interface ApiKeyRow {
  id: number;
  provider: string;
  keyHint: string | null;
  createdAt: Date | null;
  rotatedAt: Date | null;
}

/**
 * List all API keys for a tenant, with `encryptedKey` redacted.
 * Only exposes metadata — no key material leaves the server (S4).
 */
export async function listApiKeysForTenant(
  tenantId: number,
): Promise<ApiKeyRow[]> {
  return db
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
}

export interface InsertApiKeyParams {
  tenantId: number;
  provider: string;
  encryptedKey: string;
  keyHint: string;
}

/**
 * Insert a new encrypted API key row for a tenant.
 * The `encryptedKey` must already be encrypted by `crypto.ts` — this
 * function does not encrypt (the caller owns that responsibility so the
 * layer boundary is explicit).
 */
export async function insertApiKey(params: InsertApiKeyParams) {
  const [row] = await db
    .insert(apiKeys)
    .values({
      tenantId: params.tenantId,
      provider: params.provider,
      encryptedKey: params.encryptedKey,
      keyHint: params.keyHint,
    })
    .returning({ id: apiKeys.id });

  return row;
}

/**
 * Delete an API key row, scoped to a specific tenant.
 * Returns the number of deleted rows (0 if the id did not belong to the
 * tenant, preventing cross-tenant deletion).
 */
export async function deleteApiKey(
  tenantId: number,
  id: number,
): Promise<number> {
  const result = await db
    .delete(apiKeys)
    .where(and(eq(apiKeys.id, id), eq(apiKeys.tenantId, tenantId)));

  return result.rowCount ?? 0;
}
