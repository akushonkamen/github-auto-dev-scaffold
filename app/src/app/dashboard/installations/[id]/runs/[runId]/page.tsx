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
      <main className="flex min-h-screen flex-col items-center gap-4 p-8">
        <h1 className="text-2xl font-bold">Access denied</h1>
        <Link href="/dashboard" className="text-primary underline">返回 Dashboard</Link>
      </main>
    );
  }

  const run = await findRunInInstallation(runId, installation.id);
  if (!run) notFound();

  const logs = await listUsageLogsForRun(run.id);

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 p-8">
      <div className="w-full max-w-4xl">
        <Link
          href={`/dashboard/installations/${dbId}/runs`}
          className="text-sm text-muted-foreground underline"
        >
          ← Run 列表
        </Link>
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
      />

      <section className="w-full max-w-4xl space-y-2">
        <h2 className="text-xl font-semibold">阶段用量明细</h2>
        {logs.length === 0 ? (
          <p className="text-muted-foreground">
            暂无 usage_logs 行（usage 上报链路在 Issue #9 落地）。
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-2 pr-4">阶段</th>
                <th className="py-2 pr-4">Model</th>
                <th className="py-2 pr-4">Input Tokens</th>
                <th className="py-2 pr-4">Output Tokens</th>
                <th className="py-2 pr-4">Cost (USD)</th>
                <th className="py-2 pr-4">调用时间</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className="border-t">
                  <td className="py-2 pr-4 font-mono">{l.stage}</td>
                  <td className="py-2 pr-4 font-mono">{l.model}</td>
                  <td className="py-2 pr-4">{l.inputTokens ?? "—"}</td>
                  <td className="py-2 pr-4">{l.outputTokens ?? "—"}</td>
                  <td className="py-2 pr-4">{l.costUsd ?? "—"}</td>
                  <td className="py-2 pr-4">{fmtDate(l.calledAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
