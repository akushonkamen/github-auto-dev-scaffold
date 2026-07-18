import "server-only";
import { NextResponse } from "next/server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/auth/config";
import { getTenantIdForSessionUser } from "@/lib/tenant";
import { deleteApiKey } from "@/lib/api-keys-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/settings/api-keys/[id]
 *
 * Tenant-scoped delete. The id from the URL is paired with the session's
 * tenantId — a row from another tenant is never deleted (returns 404).
 */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: idStr } = await context.params;
  const id = Number.parseInt(idStr, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenantId = await getTenantIdForSessionUser(session);
  if (tenantId === null) {
    return NextResponse.json(
      { error: "Tenant not initialized" },
      { status: 409 },
    );
  }

  const ok = await deleteApiKey(tenantId, id);
  if (!ok) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
