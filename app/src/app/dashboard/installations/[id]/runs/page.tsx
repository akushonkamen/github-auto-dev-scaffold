import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { getServerSession } from "next-auth";
import { authOptions } from "@/auth/config";
import { getAppInstallationsForUser } from "@/auth/with-app-installer";
import {
  findInstallationByDbId,
} from "@/lib/installations-queries";
import { listRecentRunsForInstallation } from "@/lib/runs-queries";
import { RunsLiveTable } from "./RunsLiveTable";

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
  if (!session?.user) redirect(`/login?callbackUrl=/dashboard/installations/${dbId}/runs`);

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
      <main className="flex min-h-screen flex-col items-center gap-4 p-8">
        <h1 className="text-2xl font-bold">Access denied</h1>
        <Link href="/dashboard" className="text-primary underline">返回 Dashboard</Link>
      </main>
    );
  }

  const recent = await listRecentRunsForInstallation(installation.id, 50);

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 p-8">
      <div className="w-full max-w-4xl">
        <Link href={`/dashboard/installations/${dbId}`} className="text-sm text-muted-foreground underline">
          ← {installation.repoFullName}
        </Link>
      </div>

      <header className="flex w-full max-w-4xl items-baseline justify-between">
        <h1 className="text-2xl font-bold">最近 Run</h1>
        <span className="text-sm text-muted-foreground">
          {recent.length} / 50 条
        </span>
      </header>

      <section className="w-full max-w-4xl">
        {recent.length === 0 ? (
          <p className="text-muted-foreground">还没有 run。</p>
        ) : (
          <RunsLiveTable initialRuns={recent.map((r) => ({
            id: r.id,
            issueNumber: r.issueNumber,
            prNumber: r.prNumber,
            currentStage: r.currentStage,
            status: r.status,
            aiTokensUsed: r.aiTokensUsed,
            startedAt: r.startedAt ? r.startedAt.toISOString() : null,
            completedAt: r.completedAt ? r.completedAt.toISOString() : null,
          }))} fmtDate={fmtDate} installationDbId={dbId} />
        )}
      </section>
    </main>
  );
}
