import { notFound, redirect } from "next/navigation";

import { getServerSession } from "next-auth";
import { authOptions } from "@/auth/config";
import { getAppInstallationsForUser } from "@/auth/with-app-installer";
import { findInstallationByDbId } from "@/lib/installations-queries";
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
