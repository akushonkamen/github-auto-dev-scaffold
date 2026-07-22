import "server-only";
import { NextResponse } from "next/server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/auth/config";
import { getAppInstallationsForUser } from "@/auth/with-app-installer";
import { findInstallationByDbId } from "@/lib/installations-queries";
import { upgradePipeline } from "@/lib/deploy-pipeline/versioning";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/installations/[id]/upgrade-pipeline
 *
 * Pushes the latest pipeline bundle into the installation's repo and bumps
 * `installations.pipeline_version`. Mirrors the deploy wizard's auth model:
 *   1. Session required
 *   2. Session token must still list this installation via GitHub API
 *   3. PAT (if provided in body) is used for the actual writes — same reason
 *      as the deploy wizard (GitHub App tokens 403 on actions/variables)
 *
 * Body:
 *   { llmKey: string, claudePat?: string, claudePatOwner?: string,
 *     baseBranch?: string, vars?: Record<string, string> }
 *
 * Returns: { ok: true, newVersion } | { ok: false, error }
 */
interface UpgradeBody {
  llmKey?: string;
  claudePat?: string;
  claudePatOwner?: string;
  baseBranch?: string;
  vars?: Record<string, string>;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const dbId = Number.parseInt(id, 10);
  if (!Number.isFinite(dbId) || dbId <= 0) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const installation = await findInstallationByDbId(dbId);
  if (!installation) {
    return NextResponse.json({ error: "Installation not found" }, { status: 404 });
  }

  // Re-check access: cookie + path alone must not grant access (S11).
  if (!session.accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let authorized = false;
  try {
    const accessible = await getAppInstallationsForUser(session.accessToken);
    authorized = accessible.some((i) => i.id === installation.installationId);
  } catch {
    authorized = false;
  }
  if (!authorized) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  let body: UpgradeBody = {};
  try {
    body = (await req.json()) as UpgradeBody;
  } catch {
    // Empty body is fine only if llmKey is not required — but upgrade
    // re-applies deploy which always needs llmKey.
  }
  if (!body.llmKey || body.llmKey.length < 8) {
    return NextResponse.json(
      { error: "llmKey is required (min 8 chars)" },
      { status: 400 },
    );
  }

  const token = body.claudePat?.trim() || session.accessToken;
  const result = await upgradePipeline(dbId, installation.repoFullName, token, {
    llmKey: body.llmKey,
    claudePat: body.claudePat,
    claudePatOwner: body.claudePatOwner,
    baseBranch: body.baseBranch,
    vars: body.vars,
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error ?? "upgrade failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, newVersion: result.newVersion });
}
