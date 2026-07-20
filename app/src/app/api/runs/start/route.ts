import "server-only";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/auth/config";
import { getAppInstallationsForUser } from "@/auth/with-app-installer";
import { findInstallationByDbId } from "@/lib/installations-queries";
import { upsertRun } from "@/lib/runs";

/**
 * POST /api/runs/start
 *
 * Creates a GitHub Issue on the installation's repo (as the user, via their
 * OAuth token — Issue author shows as the human, not the App). The repo's
 * own `issues.opened` webhook will trigger the triage workflow via QStash;
 * we do NOT dispatch manually here (the webhook pipeline is the source of
 * truth, S3).
 *
 * We then upsert a `runs` row so the client can immediately subscribe to
 * /api/runs/<runId>/events before any stage data arrives.
 *
 * Body: { installationDbId: number, title: string, body: string }
 * Returns: { runId: number, issueNumber: number, repoFullName: string }
 */
export async function POST(request: Request): Promise<Response> {
  const session = await getServerSession(authOptions);
  if (!session?.user || !session.accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { installationDbId?: unknown; title?: unknown; body?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const installationDbId = Number.parseInt(String(body.installationDbId ?? ""), 10);
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const issueBody = typeof body.body === "string" ? body.body : "";
  if (!Number.isFinite(installationDbId) || installationDbId <= 0) {
    return NextResponse.json({ error: "Invalid installationDbId" }, { status: 400 });
  }
  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 422 });
  }

  const inst = await findInstallationByDbId(installationDbId);
  if (!inst) {
    return NextResponse.json({ error: "Installation not found" }, { status: 404 });
  }

  // Authorization: the user's GitHub OAuth token must list this installation.
  let authorized = false;
  try {
    const accessible = await getAppInstallationsForUser(session.accessToken);
    authorized = accessible.some((i) => i.id === inst.installationId);
  } catch {
    authorized = false;
  }
  if (!authorized) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Create issue as the user (their OAuth token). The repo's webhook fires
  // issues.opened → qstash → triage-issue.yml dispatch automatically.
  const res = await fetch(
    `https://api.github.com/repos/${inst.repoFullName}/issues`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${session.accessToken}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        title,
        body: issueBody || undefined,
        labels: ["triage"],
      }),
    },
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    return NextResponse.json(
      {
        error: "github_create_issue_failed",
        status: res.status,
        detail: errText.slice(0, 200),
      },
      { status: 502 },
    );
  }

  const json = (await res.json()) as { number: number };
  const issueNumber = json.number;

  const { runId } = await upsertRun({
    installationDbId,
    issueNumber,
    currentStage: "triage",
    status: "queued",
  });

  return NextResponse.json({
    runId,
    issueNumber,
    repoFullName: inst.repoFullName,
  });
}
