import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { getServerSession } from "next-auth";
import { authOptions } from "@/auth/config";
import { getAppInstallationsForUser } from "@/auth/with-app-installer";
import { findInstallationByDbId } from "@/lib/installations-queries";
import { listRecentRunsForInstallation } from "@/lib/runs-queries";
import { RunsLiveTable } from "./RunsLiveTable";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface PageProps {
  params: Promise<{ id: string }>;
}

function fmtDate(value: Date | string | null): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

export default async function RunsListPage({ params }: PageProps) {
  const { id } = await params;
  const dbId = Number.parseInt(id, 10);
  if (!Number.isFinite(dbId) || dbId <= 0) notFound();

  const session = await getServerSession(authOptions);
  if (!session?.user)
    redirect(`/login?callbackUrl=/dashboard/installations/${dbId}/runs`);

  const installation = await findInstallationByDbId(dbId);
  if (!installation) notFound();

  // Access control: every read still verifies GitHub token lists this installation.
  if (!session.accessToken) redirect("/login");
  let authorized = false;
  try {
    const accessible = await getAppInstallationsForUser(session.accessToken);
    authorized = accessible.some((i) => i.id === installation.installationId);
  } catch {
    authorized = false;
  }
  if (!authorized) {
    return (
      <AppShell>
        <Card className="mx-auto max-w-md">
          <CardContent className="space-y-2 p-6">
            <h1 className="text-lg font-semibold">无权访问</h1>
            <p className="text-sm text-muted-foreground">
              该 installation 不在当前账号可访问的列表里。
            </p>
            <Button asChild size="sm" variant="outline">
              <Link href="/dashboard">返回 Dashboard</Link>
            </Button>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  const recent = await listRecentRunsForInstallation(installation.id, 50);

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="space-y-2">
          <div className="text-xs text-muted-foreground">
            <Link
              href={`/dashboard/installations/${dbId}`}
              className="font-mono underline underline-offset-2"
            >
              {installation.repoFullName}
            </Link>
            {" / "}
            <span>runs</span>
          </div>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight">最近 Run</h1>
              <p className="text-sm text-muted-foreground">
                前 10 条未结束的 run 自动实时刷新（SSE）。
              </p>
            </div>
            <span className="text-xs text-muted-foreground">
              <span className="font-mono text-foreground">{recent.length}</span> / 50 条
            </span>
          </div>
        </header>

        <Card>
          <CardContent className="p-0">
            {recent.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">
                还没有 run。在 GitHub 上开个 Issue 试试。
              </p>
            ) : (
              <RunsLiveTable
                initialRuns={recent.map((r) => ({
                  id: r.id,
                  issueNumber: r.issueNumber,
                  prNumber: r.prNumber,
                  currentStage: r.currentStage,
                  status: r.status,
                  aiTokensUsed: r.aiTokensUsed,
                  startedAt: r.startedAt ? r.startedAt.toISOString() : null,
                  completedAt: r.completedAt ? r.completedAt.toISOString() : null,
                }))}
                fmtDate={fmtDate}
                installationDbId={dbId}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
