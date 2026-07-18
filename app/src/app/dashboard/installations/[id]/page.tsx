import { getServerSession } from "next-auth";
import { authOptions } from "@/auth/config";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import {
  verifyInstallationAccess,
  getInstallationDetail,
} from "@/lib/dashboard";
import { formatDistanceToNow } from "@/lib/utils";
import { SetActiveButton } from "./set-active-button";

interface Props {
  params: { id: string };
}

/**
 * Installation detail page — /dashboard/installations/[id]
 *
 * Shows installation metadata and the last 10 pipeline runs.
 * Every page load re-verifies the session user can access this installation
 * via GitHub API (IDOR protection, AC-004).
 */
export default async function InstallationDetailPage({ params }: Props) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login?callbackUrl=/dashboard/installations/" + params.id);

  const installationId = Number(params.id);
  if (!Number.isInteger(installationId) || installationId <= 0) {
    notFound();
  }

  // IDOR guard: verify the session user's token grants access to this installation
  if (!session.accessToken) {
    redirect("/login?callbackUrl=/dashboard/installations/" + params.id);
  }

  const hasAccess = await verifyInstallationAccess(
    session.accessToken,
    installationId,
  );
  if (!hasAccess) {
    notFound();
  }

  // Fetch detail data
  const detail = await getInstallationDetail(session.accessToken, installationId);

  return (
    <main className="flex min-h-screen flex-col items-center gap-8 p-8">
      <div className="w-full max-w-lg">
        {/* Breadcrumb */}
        <nav className="mb-6 text-sm text-muted-foreground">
          <Link
            href="/dashboard"
            className="underline underline-offset-2 hover:text-foreground"
          >
            Dashboard
          </Link>
          <span className="mx-2">/</span>
          <span className="text-foreground font-medium">
            {detail.accountLogin}
          </span>
        </nav>

        <h1 className="text-3xl font-bold tracking-tight mb-6">
          {detail.accountLogin}
          <span className="ml-2 text-lg font-normal text-muted-foreground">
            ({detail.accountType})
          </span>
        </h1>

        {/* Metadata card */}
        <section className="rounded-lg border p-4 space-y-3 mb-6">
          <h2 className="text-lg font-semibold">Installation Details</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Installation ID</dt>
              <dd className="font-mono tabular-nums">{detail.id}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Repository</dt>
              <dd>
                {detail.repoFullName ?? (
                  <span className="italic text-muted-foreground">
                    Webhook pending
                  </span>
                )}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Repository selection</dt>
              <dd className="capitalize">
                {detail.repositorySelection === "all" ? "All repos" : "Selected repos"}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Installed</dt>
              <dd>
                {detail.installedAt ? (
                  <time dateTime={detail.installedAt.toISOString()}>
                    {formatDistanceToNow(detail.installedAt)} ago
                  </time>
                ) : (
                  <span className="italic text-muted-foreground">Pending</span>
                )}
              </dd>
            </div>
          </dl>

          <div className="pt-2">
            <SetActiveButton installationId={detail.id} accountLogin={detail.accountLogin} />
          </div>
        </section>

        {/* Recent runs */}
        <section className="rounded-lg border p-4 space-y-3">
          <h2 className="text-lg font-semibold">Recent Runs</h2>
          {detail.recentRuns.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No pipeline runs yet. When an Issue is dispatched for this
              installation, runs will appear here.
            </p>
          ) : (
            <ul className="divide-y">
              {detail.recentRuns.map((run) => (
                <li key={run.id} className="py-2 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">
                      #{run.issueNumber}
                    </span>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        run.status === "completed" || run.status === "merged"
                          ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                          : run.status === "failed" || run.status === "cancelled"
                            ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                            : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
                      }`}
                    >
                      {run.status ?? "pending"}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    {run.currentStage && <span>Stage: {run.currentStage}</span>}
                    {run.startedAt && (
                      <span>
                        {formatDistanceToNow(run.startedAt)} ago
                      </span>
                    )}
                    {run.prNumber && (
                      <span>PR #{run.prNumber}</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
