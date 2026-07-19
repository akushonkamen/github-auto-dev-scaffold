import { notFound, redirect } from "next/navigation";

import { getServerSession } from "next-auth";
import { authOptions } from "@/auth/config";
import { getAppInstallationsForUser } from "@/auth/with-app-installer";
import {
  clearActiveInstallation,
  getActiveInstallationDbId,
} from "@/lib/active-installation";
import { findInstallationByDbId } from "@/lib/installations-queries";

import { CreateWorkspace } from "./CreateWorkspace";

/**
 * /create — vibecoding 单焦点工作台。
 *
 * 需要 active installation：从 cookie 读，没有就回 dashboard 让用户挑。
 * 鉴权：session 必须存在，且 cookie 的 installation 必须在 user 的可访问列表里。
 */
export default async function CreatePage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login?callbackUrl=/create");
  if (!session.accessToken) redirect("/login");

  const cookieDbId = await getActiveInstallationDbId();
  if (!cookieDbId) {
    redirect("/dashboard?reason=no-active-installation");
  }

  const inst = await findInstallationByDbId(cookieDbId);
  if (!inst) {
    await clearActiveInstallation();
    redirect("/dashboard?reason=stale-installation");
  }

  let authorized = false;
  try {
    const accessible = await getAppInstallationsForUser(session.accessToken);
    authorized = accessible.some((i) => i.id === inst.installationId);
  } catch {
    authorized = false;
  }
  if (!authorized) {
    redirect("/dashboard?reason=forbidden");
  }

  return (
    <CreateWorkspace
      installationDbId={inst.id}
      repoFullName={inst.repoFullName}
    />
  );
}
