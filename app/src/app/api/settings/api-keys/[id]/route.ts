import "server-only";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/auth/config";
import { deleteApiKey } from "@/lib/api-keys-queries";
import { getTenantIdForSessionUser } from "@/lib/tenant";

// ── DELETE /api/settings/api-keys/[id] ───────────────────────────────────
// Tenant-scoped key deletion. The tenant id is derived from the session,
// never from client input — this prevents cross-tenant key deletion.
export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
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

  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid key id" }, { status: 400 });
  }

  const deleted = await deleteApiKey(tenantId, id);

  if (deleted === 0) {
    return NextResponse.json(
      { error: "Key not found" },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true });
}
