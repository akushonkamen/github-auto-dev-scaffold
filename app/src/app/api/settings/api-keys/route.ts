import "server-only";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/auth/config";
import { encrypt } from "@/lib/crypto";
import { insertApiKey } from "@/lib/api-keys-queries";
import { getTenantIdForSessionUser } from "@/lib/tenant";

// ── POST /api/settings/api-keys ──────────────────────────────────────────
// Programmatic endpoint: accepts { provider, apiKey }, encrypts the key,
// inserts into DB, returns the new row (metadata only — never echoes the
// raw key). Server-side validation + tenant scoping (S4).
export const dynamic = "force-dynamic";

const VALID_PROVIDERS = new Set([
  "anthropic",
  "openai",
  "deepseek",
  "custom",
]);

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenantId = await getTenantIdForSessionUser(session);
  if (!tenantId) {
    return NextResponse.json(
      { error: "No tenant found for this user" },
      { status: 404 },
    );
  }

  let body: { provider?: unknown; apiKey?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const { provider, apiKey } = body;

  if (typeof provider !== "string" || !VALID_PROVIDERS.has(provider)) {
    return NextResponse.json(
      {
        error: `Invalid provider. Must be one of: ${Array.from(VALID_PROVIDERS).join(", ")}`,
      },
      { status: 400 },
    );
  }

  if (typeof apiKey !== "string" || apiKey.length === 0) {
    return NextResponse.json(
      { error: "apiKey is required and must be a non-empty string" },
      { status: 400 },
    );
  }

  // Encrypt — throws on missing / invalid master key (security: never
  // fall back to a hardcoded key).
  let encryptedKey: string;
  try {
    encryptedKey = encrypt(apiKey);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Encryption failed";
    // S4: generic message, never log the raw error which could hint at
    // the master key format.
    console.error("BYOK encryption error:", message);
    return NextResponse.json(
      {
        error: "Internal encryption error — check server configuration",
      },
      { status: 500 },
    );
  }

  // keyHint: last 4 characters — enough for the user to identify which
  // key they're looking at, never enough to reconstruct (S4).
  const keyHint = apiKey.length >= 4 ? apiKey.slice(-4) : apiKey;

  const row = await insertApiKey({
    tenantId,
    provider,
    encryptedKey,
    keyHint,
  });

  return NextResponse.json(
    {
      id: row.id,
      provider,
      keyHint,
    },
    { status: 201 },
  );
}
