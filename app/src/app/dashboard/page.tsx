import { getServerSession } from "next-auth";
import { authOptions } from "@/auth/config";
import { INSTALLATION_URL } from "@/auth/with-app-installer";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getDashboardInstallations } from "@/lib/dashboard";
import { formatDistanceToNow } from "@/lib/utils";

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login?callbackUrl=/dashboard");

  const githubLogin = (session.user as Record<string, unknown>)
    .githubLogin as string | undefined;

  let installations: Awaited<ReturnType<typeof getDashboardInstallations>> = [];
  let installationsError = false;

  if (session.accessToken) {
    try {
      installations = await getDashboardInstallations(session.accessToken);
    } catch {
      installationsError = true;
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center gap-8 p-8">
      <h1 className="text-4xl font-bold tracking-tight">Dashboard</h1>

      <section className="w-full max-w-md space-y-2">
        <h2 className="text-xl font-semibold">Profile</h2>
        <p>
          Welcome, <strong>{githubLogin ?? session.user.name ?? "User"}</strong>
        </p>
        <div className="text-sm text-muted-foreground space-y-1">
          <p>
            Installations shown here are the GitHub org/user accounts that have
            installed the GithubAutoDev App. Click an installation to view its
            details.
          </p>
        </div>
      </section>

      <section className="w-full max-w-md space-y-2">
        <h2 className="text-xl font-semibold">App Installations</h2>

        {installationsError && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            Could not load installations. Try again later.
          </div>
        )}

        {!installationsError && installations.length === 0 && (
          <div className="space-y-3">
            <p className="text-muted-foreground text-sm">
              No GitHub App installations found for your account.
            </p>
            <Link
              href={INSTALLATION_URL}
              className="inline-block text-primary underline underline-offset-2 text-sm"
            >
              Install GithubAutoDev App
            </Link>
          </div>
        )}

        {installations.length > 0 && (
          <ul className="divide-y rounded-lg border">
            {installations.map((inst) => (
              <li key={inst.id}>
                <Link
                  href={`/dashboard/installations/${inst.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-accent/50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">
                      {inst.accountLogin}
                      <span className="ml-1.5 text-xs text-muted-foreground font-normal">
                        ({inst.accountType})
                      </span>
                    </p>
                    <p className="text-sm text-muted-foreground truncate mt-0.5">
                      {inst.repoFullName ?? (
                        <span className="italic">Webhook pending</span>
                      )}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-0.5 shrink-0">
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {inst.runsCount} run{inst.runsCount !== 1 ? "s" : ""}
                    </span>
                    {inst.installedAt && (
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(inst.installedAt)} ago
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
