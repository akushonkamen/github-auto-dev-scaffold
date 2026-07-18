"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { authOptions } from "@/auth/config";
import { deleteApiKey, insertApiKey } from "@/lib/api-keys-queries";
import { encrypt } from "@/lib/crypto";
import { getTenantIdForSessionUser } from "@/lib/tenant";

const VALID_PROVIDERS = ["anthropic", "openai", "deepseek", "custom"] as const;

export type ActionState =
  | { ok: true; message: string }
  | { ok: false; message: string };

/**
 * Add a new API key for the authenticated user's tenant.
 * Encrypts the key server-side, stores only `keyHint` (last-4), and
 * never echoes the raw key back to the client or in logs (S4).
 */
export async function addApiKey(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login?callbackUrl=/settings/engines");

  const tenantId = await getTenantIdForSessionUser(session);
  if (!tenantId) {
    return { ok: false, message: "No tenant found for your account." };
  }

  const provider = formData.get("provider")?.toString();
  const apiKey = formData.get("apiKey")?.toString();

  if (!provider || !VALID_PROVIDERS.includes(provider as typeof VALID_PROVIDERS[number])) {
    return {
      ok: false,
      message: `Invalid provider. Must be one of: ${VALID_PROVIDERS.join(", ")}`,
    };
  }

  if (!apiKey || apiKey.length === 0) {
    return { ok: false, message: "API key is required." };
  }

  // Encrypt — throws on missing / malformed master key.
  let encryptedKey: string;
  try {
    encryptedKey = encrypt(apiKey);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Encryption failed";
    console.error("BYOK encrypt error (server action):", msg);
    return {
      ok: false,
      message: "Encryption failed — check APP_BYOK_MASTER_KEY is configured correctly.",
    };
  }

  const keyHint = apiKey.length >= 4 ? apiKey.slice(-4) : apiKey;

  await insertApiKey({ tenantId, provider, encryptedKey, keyHint });

  revalidatePath("/settings/engines");
  return { ok: true, message: "API key added successfully." };
}

/**
 * Delete an API key, scoped to the authenticated user's tenant.
 */
export async function removeApiKey(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login?callbackUrl=/settings/engines");

  const tenantId = await getTenantIdForSessionUser(session);
  if (!tenantId) {
    return { ok: false, message: "No tenant found for your account." };
  }

  const idStr = formData.get("id")?.toString();
  if (!idStr) return { ok: false, message: "Missing key id." };

  const id = Number(idStr);
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, message: "Invalid key id." };
  }

  const deleted = await deleteApiKey(tenantId, id);
  if (deleted === 0) {
    return { ok: false, message: "Key not found or not yours." };
  }

  revalidatePath("/settings/engines");
  return { ok: true, message: "API key deleted." };
}
