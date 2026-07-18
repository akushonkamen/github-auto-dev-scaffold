import { getServerSession } from "next-auth";
import { authOptions } from "@/auth/config";
import {
  getAppInstallationsForUser,
  INSTALLATION_URL,
} from "@/auth/with-app-installer";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login?callbackUrl=/dashboard");

  const githubId = (session.user as Record<string, unknown>).githubId as
    | number
    | undefined;
  const githubLogin = (session.user as Record<string, unknown>)
    .githubLogin as string | undefined;

  let installations: { id: number; account: { login: string; type: string } }[] = [];
  let installationsError = false;

  if (session.accessToken) {
    try {
      installations = await getAppInstallationsForUser(session.accessToken);
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
        {githubId && <p>GitHub ID: {githubId}</p>}
      </section>

      <section className="w-full max-w-md space-y-2">
        <h2 className="text-xl font-semibold">App Installations</h2>
        {installations.length > 0 ? (
          <ul className="list-disc pl-5 space-y-1">
            {installations.map((inst) => (
              <li key={inst.id}>
                {inst.account.login} ({inst.account.type})
              </li>
            ))}
          </ul>
        ) : (
          <div className="space-y-2">
            <p className="text-muted-foreground">
              {installationsError
                ? "Could not load installations. Try again later."
                : "No GitHub App installations found for your account."}
            </p>
            {!installationsError && (
              <Link
                href={INSTALLATION_URL}
                className="text-primary underline underline-offset-2"
              >
                Install GithubAutoDev App
              </Link>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
