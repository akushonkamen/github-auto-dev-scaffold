import { notFound, redirect } from "next/navigation";

import { getServerSession } from "next-auth";
import { authOptions } from "@/auth/config";
import { getAppInstallationsForUser } from "@/auth/with-app-installer";
import { findInstallationByDbId } from "@/lib/installations-queries";
import { getPlanForTenant } from "@/lib/quota";
import { dryRunDeploy } from "./actions";
import { DeployWizard } from "./DeployWizard";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function DeployPage({ params }: PageProps) {
  const { id } = await params;
  const dbId = Number.parseInt(id, 10);
  if (!Number.isFinite(dbId) || dbId <= 0) notFound();

  const session = await getServerSession(authOptions);
  if (!session?.accessToken) {
    redirect(`/login?callbackUrl=/dashboard/installations/${dbId}/deploy`);
  }

  const installation = await findInstallationByDbId(dbId);
  if (!installation) notFound();

  // S11: re-check access — same pattern as the detail page.
  const accessible = await getAppInstallationsForUser(session.accessToken);
  const authorized = accessible.some((i) => i.id === installation.installationId);
  if (!authorized) {
    redirect(`/dashboard/installations/${dbId}`);
  }

  const scan = await dryRunDeploy(dbId);
  const plan = await getPlanForTenant(installation.tenantId);

  // AC3: deploy wizard is Pro+. Free tenants see a paywall CTA instead.
  if (plan === "free") {
    return (
      <main className="flex min-h-screen flex-col items-center gap-6 p-8">
        <div className="w-full max-w-2xl space-y-4 rounded-lg border border-primary/30 bg-primary/5 p-6">
          <h1 className="text-2xl font-bold">升级到 Pro 才能使用 Deploy Wizard</h1>
          <p className="text-sm text-muted-foreground">
            Free 计划只包含 Issue triage + Claude 回复。要把 pipeline 模板
            推送到 <code className="rounded bg-muted px-1 py-0.5">{installation.repoFullName}</code>，
            需要先升级到 Pro。
          </p>
          <form action="/api/billing/checkout" method="POST">
            <button
              type="submit"
              formMethod="post"
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              升级到 Pro
            </button>
          </form>
          <a
            href={`/dashboard/installations/${dbId}`}
            className="inline-block text-sm text-muted-foreground underline"
          >
            ← 返回
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 p-8">
      <div className="w-full max-w-4xl space-y-6">
        <DeployWizard
          dbId={dbId}
          repoFullName={installation.repoFullName}
          defaultOwner={installation.repoFullName.split("/")[0]}
          initialScan={scan}
        />
      </div>
    </main>
  );
}
