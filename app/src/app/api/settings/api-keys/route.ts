import "server-only";
import { NextResponse } from "next/server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/auth/config";
import { getTenantIdForSessionUser } from "@/lib/tenant";
import { insertApiKey } from "@/lib/api-keys-queries";
import { encryptKey, keyHint } from "@/lib/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_PROVIDERS = new Set([
  "anthropic",
  "openai",
  "deepseek",
  "glm",
  "custom",
]);

/**
 * POST /api/settings/api-keys
 * Body: { "provider": string, "apiKey": string }
 *
 * Encrypts the raw key with AES-256-GCM using APP_BYOK_MASTER_KEY, stores
 * the ciphertext in `api_keys.encrypted_key`, and returns the public row
 * (id, provider, keyHint, createdAt) — never the raw key.
 *
 * The POST route exists for programmatic clients (CLI, curl). The browser
 * form uses a server action (see ../../settings/engines/actions.ts).
 */
export async function POST(request: Request): Promise<Response> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const provider =
    typeof (body as { provider?: unknown })?.provider === "string"
      ? ((body as { provider: string }).provider).trim()
      : "";
  const apiKey =
    typeof (body as { apiKey?: unknown })?.apiKey === "string"
      ? ((body as { apiKey: string }).apiKey).trim()
      : "";

  if (!ALLOWED_PROVIDERS.has(provider)) {
    return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
  }
  if (apiKey.length < 8) {
    return NextResponse.json({ error: "API key too short" }, { status: 400 });
  }

  const tenantId = await getTenantIdForSessionUser(session);
  if (tenantId === null) {
    return NextResponse.json(
      { error: "Tenant not initialized" },
      { status: 409 },
    );
  }

  let encryptedKey: string;
  let hint: string;
  try {
    encryptedKey = encryptKey(apiKey);
    hint = keyHint(apiKey);
  } catch {
    // Missing/malformed master key — generic 500, no leak (S4).
    return NextResponse.json(
      { error: "Encryption unavailable" },
      { status: 500 },
    );
  }

  const row = await insertApiKey({
    tenantId,
    provider,
    encryptedKey,
    keyHint: hint,
  });

  return NextResponse.json(
    { id: row.id, provider, keyHint: hint },
    { status: 201 },
  );
}
