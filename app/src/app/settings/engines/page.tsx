import { getServerSession } from "next-auth";
import Link from "next/link";
import { redirect } from "next/navigation";

import { authOptions } from "@/auth/config";
import { listApiKeysForTenant } from "@/lib/api-keys-queries";
import { getTenantIdForSessionUser } from "@/lib/tenant";
import { AddKeyForm } from "./AddKeyForm";
import { DeleteKeyButton } from "./DeleteKeyButton";

export default async function EnginesSettingsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login?callbackUrl=/settings/engines");

  const tenantId = await getTenantIdForSessionUser(session);
  if (!tenantId) {
    return (
      <main className="flex min-h-screen flex-col items-center gap-8 p-8">
        <p className="text-muted-foreground">
          No tenant found for your account. Contact support if this persists.
        </p>
      </main>
    );
  }

  const keys = await listApiKeysForTenant(tenantId);

  return (
    <main className="flex min-h-screen flex-col items-center gap-8 p-8">
      <header className="flex w-full max-w-3xl items-baseline justify-between">
        <h1 className="text-4xl font-bold tracking-tight">Engine API Keys</h1>
        <Link
          href="/dashboard"
          className="text-sm text-muted-foreground underline underline-offset-2"
        >
          Dashboard
        </Link>
      </header>

      <section className="w-full max-w-3xl space-y-4 rounded-lg border p-4">
        <h2 className="text-xl font-semibold">Add a Key</h2>
        <AddKeyForm />
      </section>

      <section className="w-full max-w-3xl space-y-4">
        <h2 className="text-xl font-semibold">Saved Keys</h2>
        {keys.length === 0 ? (
          <p className="text-muted-foreground">
            No API keys saved yet. Add one above.
          </p>
        ) : (
          <ul className="space-y-2">
            {keys.map((key) => (
              <li
                key={key.id}
                className="flex items-center justify-between rounded-md border p-3"
              >
                <div className="space-y-1">
                  <div className="flex items-baseline gap-3">
                    <span className="font-medium capitalize">{key.provider}</span>
                    <span className="text-sm text-muted-foreground">
                      …{key.keyHint}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Added {key.createdAt?.toISOString().slice(0, 10) ?? "unknown"}
                    {key.rotatedAt && (
                      <> · Rotated {key.rotatedAt.toISOString().slice(0, 10)}</>
                    )}
                  </div>
                </div>
                <DeleteKeyButton id={key.id} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
