import "server-only";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/auth/config";
import { getAppInstallationsForUser } from "@/auth/with-app-installer";
import { findInstallationByDbId } from "@/lib/installations-queries";
import { findInstallationForRun, findRunInInstallation } from "@/lib/runs-queries";

/**
 * GET /api/runs/<runId>/comments
 *
 * Fetches the parent issue's comments and filters to those authored by a
 * bot (login ends with `[bot]`). These are the structured clarify-loop /
 * review verdict comments the chat panel renders as AI messages.
 *
 * Uses the user's OAuth token — installation tokens would also work but
 * would bypass any private-repo read ACLs the user has.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ runId: string }> },
): Promise<Response> {
  const { runId: runIdStr } = await context.params;
  const runId = Number.parseInt(runIdStr, 10);
  if (!Number.isFinite(runId) || runId <= 0) {
    return NextResponse.json({ error: "Invalid runId" }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  if (!session?.user || !session.accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const inst = await findInstallationForRun(runId);
  if (!inst) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  const run = await findRunInInstallation(runId, inst.installationDbId);
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  const instRow = await findInstallationByDbId(inst.installationDbId);
  if (!instRow) {
    return NextResponse.json({ error: "Installation not found" }, { status: 404 });
  }

  let authorized = false;
  try {
    const accessible = await getAppInstallationsForUser(session.accessToken);
    authorized = accessible.some((i) => i.id === inst.installationGithubId);
  } catch {
    authorized = false;
  }
  if (!authorized) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const commentsRes = await fetch(
    `https://api.github.com/repos/${instRow.repoFullName}/issues/${run.issueNumber}/comments`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${session.accessToken}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      cache: "no-store",
    },
  );
  if (!commentsRes.ok) {
    return NextResponse.json(
      { error: "github_comments_fetch_failed", status: commentsRes.status },
      { status: 502 },
    );
  }

  const raw = (await commentsRes.json()) as Array<{
    id: number;
    body: string;
    created_at: string;
    user: { login: string } | null;
    html_url?: string;
  }>;

  const aiMessages = raw
    .filter((c) => c.user?.login?.endsWith("[bot]"))
    .map((c) => ({
      id: c.id,
      role: "ai" as const,
      body: c.body,
      createdAt: c.created_at,
      url: c.html_url ?? null,
    }));

  return NextResponse.json({
    issueNumber: run.issueNumber,
    repoFullName: instRow.repoFullName,
    messages: aiMessages,
  });
}
