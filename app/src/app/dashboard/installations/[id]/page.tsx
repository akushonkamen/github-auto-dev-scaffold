import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { getServerSession } from "next-auth";
import { authOptions } from "@/auth/config";
import { getAppInstallationsForUser } from "@/auth/with-app-installer";
import {
  findInstallationByDbId,
  recentRunsForInstallation,
} from "@/lib/installations-queries";
import { setActiveInstallationDbId } from "@/lib/active-installation";
import { checkUpgradeNeeded } from "@/lib/deploy-pipeline/versioning";
import { getPlanForTenant } from "@/lib/quota";
import { UpgradeButton } from "./UpgradeButton";

interface PageProps {
  params: Promise<{ id: string }>;
}

function fmtDate(value: Date | string | null): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

export default async function InstallationDetailPage({ params }: PageProps) {
  const { id } = await params;
  const dbId = Number.parseInt(id, 10);
  if (!Number.isFinite(dbId) || dbId <= 0) notFound();

  const session = await getServerSession(authOptions);
  if (!session?.user) redirect(`/login?callbackUrl=/dashboard/installations/${dbId}`);

  const installation = await findInstallationByDbId(dbId);
  if (!installation) notFound();

  // S11: every read still has to verify the user actually has access to this
  // installation via the GitHub API. Cookie + path alone are not enough —
  // anyone could guess a numeric db id.
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
        <p className="text-muted-foreground">
          Your GitHub token no longer lists installation {installation.installationId}.
        </p>
        <Link href="/dashboard" className="text-primary underline">Back to dashboard</Link>
      </main>
    );
  }

  const recentRuns = await recentRunsForInstallation(installation.id, 10);
  const versionInfo = await checkUpgradeNeeded(installation.id);
  const plan = await getPlanForTenant(installation.tenantId);

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 p-8">
      <div className="w-full max-w-3xl">
        <Link href="/dashboard" className="text-sm text-muted-foreground underline">
          ← All installations
        </Link>
      </div>

      <header className="flex w-full max-w-3xl items-baseline justify-between">
        <h1 className="text-2xl font-bold">{installation.repoFullName}</h1>
        <div className="flex gap-2">
          <Link
            href={`/dashboard/installations/${dbId}/deploy`}
            className="rounded-md bg-primary px-3 py-1 text-sm text-primary-foreground hover:bg-primary/90"
          >
            Deploy Pipeline
          </Link>
          <form action={async () => {
            "use server";
            await setActiveInstallationDbId(installation.id);
            redirect("/dashboard");
          }}>
            <button
              type="submit"
              className="rounded-md border px-3 py-1 text-sm hover:bg-accent"
            >
              Set as active
            </button>
          </form>
        </div>
      </header>

      <section className="w-full max-w-3xl space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">Pipeline version</h2>
          <div className="flex items-center gap-2">
            <code className="rounded bg-muted px-2 py-0.5">{versionInfo.current}</code>
            <span className="text-muted-foreground">→</span>
            <code className="rounded bg-muted px-2 py-0.5">{versionInfo.latest}</code>
          </div>
        </div>
        {versionInfo.needsUpgrade ? (
          <UpgradeButton dbId={dbId} latest={versionInfo.latest} />
        ) : (
          <p className="text-muted-foreground">Up to date.</p>
        )}
      </section>

      <section className="w-full max-w-3xl space-y-1 rounded-lg border p-4 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">GitHub installation ID</span>
          <code>{installation.installationId}</code>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Installed</span>
          <span>{fmtDate(installation.installedAt)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Uninstalled</span>
          <span>{fmtDate(installation.uninstalledAt)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Total runs</span>
          <span>{installation.runsCount}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Plan</span>
          <span className="font-medium uppercase">{plan}</span>
        </div>
      </section>

      <section className="w-full max-w-3xl space-y-2">
        <h2 className="text-xl font-semibold">Recent runs</h2>
        {recentRuns.length === 0 ? (
          <p className="text-muted-foreground">No runs yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-2 pr-4">#</th>
                <th className="py-2 pr-4">Stage</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Started</th>
                <th className="py-2 pr-4">PR</th>
              </tr>
            </thead>
            <tbody>
              {recentRuns.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="py-2 pr-4">#{r.issueNumber}</td>
                  <td className="py-2 pr-4 font-mono">{r.currentStage ?? "—"}</td>
                  <td className="py-2 pr-4 font-mono">{r.status ?? "—"}</td>
                  <td className="py-2 pr-4">{fmtDate(r.startedAt)}</td>
                  <td className="py-2 pr-4">{r.prNumber ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-xs text-muted-foreground">
          Live updates (SSE) land in Issue #7.
        </p>
      </section>
    </main>
  );
}
