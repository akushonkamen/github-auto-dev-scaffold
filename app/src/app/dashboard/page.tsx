import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { authOptions } from "@/auth/config";
import { INSTALLATION_URL, getAppInstallationsForUser } from "@/auth/with-app-installer";
import { findInstallationByGithubId } from "@/lib/installations-queries";
import { getActiveInstallationDbId } from "@/lib/active-installation";

interface GithubInstallation {
  id: number;
  account: { login: string; type: string };
}

interface EnrichedRow {
  github: GithubInstallation;
  dbId: number | null;
  repoFullName: string | null;
  installedAt: Date | null;
  runsCount: number;
  isActive: boolean;
}

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login?callbackUrl=/dashboard");

  const githubId = (session.user as Record<string, unknown>).githubId as
    | number
    | undefined;
  const githubLogin = (session.user as Record<string, unknown>).githubLogin as
    | string
    | undefined;

  let installations: GithubInstallation[] = [];
  let installationsError = false;
  if (session.accessToken) {
    try {
      installations = await getAppInstallationsForUser(session.accessToken);
    } catch {
      installationsError = true;
    }
  }

  const activeDbId = await getActiveInstallationDbId();

  const rows: EnrichedRow[] = [];
  for (const inst of installations) {
    const meta = await findInstallationByGithubId(inst.id).catch(() => null);
    rows.push({
      github: inst,
      dbId: meta?.id ?? null,
      repoFullName: meta?.repoFullName ?? null,
      installedAt: meta?.installedAt ?? null,
      runsCount: meta?.runsCount ?? 0,
      isActive: meta?.id != null && meta.id === activeDbId,
    });
  }

  return (
    <main className="flex min-h-screen flex-col items-center gap-8 p-8">
      <header className="flex w-full max-w-3xl items-baseline justify-between">
        <h1 className="text-4xl font-bold tracking-tight">Dashboard</h1>
        <Link href="/settings" className="text-sm text-muted-foreground underline underline-offset-2">
          Settings
        </Link>
      </header>

      <section className="w-full max-w-3xl space-y-2 rounded-lg border p-4">
        <h2 className="text-xl font-semibold">Profile</h2>
        <p>
          Welcome, <strong>{githubLogin ?? session.user.name ?? "User"}</strong>
        </p>
        {githubId && <p className="text-sm text-muted-foreground">GitHub ID: {githubId}</p>}
      </section>

      <section className="w-full max-w-3xl space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xl font-semibold">App Installations</h2>
          <Link
            href={INSTALLATION_URL}
            className="text-sm text-primary underline underline-offset-2"
          >
            Add installation
          </Link>
        </div>

        {installationsError ? (
          <p className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
            Could not load installations from GitHub. Reconnect in{" "}
            <Link href="/login" className="underline">/login</Link>.
          </p>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground">
            No GitHub App installations found for your account.
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => {
              const account = `${row.github.account.login} (${row.github.account.type})`;
              const target =
                row.dbId != null ? `/dashboard/installations/${row.dbId}` : null;
              const inner = (
                <>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium">{account}</span>
                    {row.isActive && (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                        Active
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {row.repoFullName ?? "Webhook pending — installation event not received yet."}
                  </div>
                  <div className="flex items-baseline justify-between text-xs text-muted-foreground">
                    <span>{row.runsCount} run{row.runsCount === 1 ? "" : "s"}</span>
                    {row.installedAt && (
                      <span>Installed {row.installedAt.toISOString().slice(0, 10)}</span>
                    )}
                  </div>
                </>
              );
              return (
                <li
                  key={row.github.id}
                  className={
                    "rounded-md border p-3 transition hover:border-primary/60 " +
                    (row.isActive ? "border-primary/60 bg-primary/5" : "")
                  }
                >
                  {target ? (
                    <Link href={target} className="block space-y-1">
                      {inner}
                    </Link>
                  ) : (
                    <div className="space-y-1 opacity-70">{inner}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
