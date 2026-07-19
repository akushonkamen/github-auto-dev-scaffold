import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { getServerSession } from "next-auth";
import { authOptions } from "@/auth/config";
import { getAppInstallationsForUser } from "@/auth/with-app-installer";
import { findInstallationByDbId } from "@/lib/installations-queries";
import {
  findRunInInstallation,
  listUsageLogsForRun,
} from "@/lib/runs-queries";
import { RunDetailHeader } from "./RunDetailHeader";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface PageProps {
  params: Promise<{ id: string; runId: string }>;
}

function fmtDate(value: Date | string | null): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

export default async function RunDetailPage({ params }: PageProps) {
  const { id, runId: runIdStr } = await params;
  const dbId = Number.parseInt(id, 10);
  const runId = Number.parseInt(runIdStr, 10);
  if (!Number.isFinite(dbId) || dbId <= 0) notFound();
  if (!Number.isFinite(runId) || runId <= 0) notFound();

  const session = await getServerSession(authOptions);
  if (!session?.user) {
    redirect(`/login?callbackUrl=/dashboard/installations/${dbId}/runs/${runId}`);
  }

  const installation = await findInstallationByDbId(dbId);
  if (!installation) notFound();

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

  const run = await findRunInInstallation(runId, installation.id);
  if (!run) notFound();

  const logs = await listUsageLogsForRun(run.id);

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="text-xs text-muted-foreground">
          <Link
            href={`/dashboard/installations/${dbId}/runs`}
            className="font-mono underline underline-offset-2"
          >
            {installation.repoFullName} / runs
          </Link>
          {" / "}
          <span>#{runId}</span>
        </div>

        <RunDetailHeader
          run={{
            id: run.id,
            issueNumber: run.issueNumber,
            prNumber: run.prNumber,
            currentStage: run.currentStage,
            status: run.status,
            aiTokensUsed: run.aiTokensUsed,
            aiMinutesUsed: run.aiMinutesUsed,
            startedAt: run.startedAt ? run.startedAt.toISOString() : null,
            completedAt: run.completedAt ? run.completedAt.toISOString() : null,
          }}
          fmtDate={fmtDate}
          repoFullName={installation.repoFullName}
        />

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">阶段用量明细</CardTitle>
            <CardDescription>
              {logs.length === 0
                ? "暂无 usage_logs 行"
                : `${logs.length} 条记录`}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {logs.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">
                暂无 usage_logs 行（usage 上报链路在 Issue #9 落地）。
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>阶段</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead className="text-right">Input Tokens</TableHead>
                    <TableHead className="text-right">Output Tokens</TableHead>
                    <TableHead className="text-right">Cost (USD)</TableHead>
                    <TableHead>调用时间</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="font-mono text-xs">{l.stage}</TableCell>
                      <TableCell className="font-mono text-xs">{l.model}</TableCell>
                      <TableCell className="text-right font-mono">
                        {l.inputTokens ?? "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {l.outputTokens ?? "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {l.costUsd != null
                          ? `$${Number(l.costUsd).toFixed(4)}`
                          : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtDate(l.calledAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
