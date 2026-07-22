"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getServerSession } from "next-auth";
import { authOptions } from "@/auth/config";
import { getTenantIdForSessionUser } from "@/lib/tenant";
import { insertApiKey, deleteApiKey } from "@/lib/api-keys-queries";
import { encryptKey, keyHint } from "@/lib/crypto";

const ALLOWED_PROVIDERS = new Set([
  "anthropic",
  "openai",
  "glm",
  "deepseek",
  "custom",
]);

export async function addApiKeyAction(formData: FormData): Promise<void> {
  const provider = String(formData.get("provider") ?? "").trim();
  const apiKey = String(formData.get("apiKey") ?? "").trim();

  if (!ALLOWED_PROVIDERS.has(provider)) {
    throw new Error("Invalid provider");
  }
  if (apiKey.length < 8) {
    throw new Error("API key too short");
  }

  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login?callbackUrl=/settings/engines");

  const tenantId = await getTenantIdForSessionUser(session);
  if (tenantId === null) {
    throw new Error("Tenant not initialized");
  }

  const encryptedKey = encryptKey(apiKey);
  const hint = keyHint(apiKey);

  await insertApiKey({ tenantId, provider, encryptedKey, keyHint: hint });

  revalidatePath("/settings/engines");
}

export async function deleteApiKeyAction(formData: FormData): Promise<void> {
  const idStr = String(formData.get("id") ?? "");
  const id = Number.parseInt(idStr, 10);
  if (!Number.isFinite(id) || id <= 0) throw new Error("Invalid id");

  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login?callbackUrl=/settings/engines");

  const tenantId = await getTenantIdForSessionUser(session);
  if (tenantId === null) throw new Error("Tenant not initialized");

  await deleteApiKey(tenantId, id);

  revalidatePath("/settings/engines");
}
