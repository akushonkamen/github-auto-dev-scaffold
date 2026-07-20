import { redirect } from "next/navigation";

import { getServerSession } from "next-auth";

import { authOptions } from "@/auth/config";

interface PageProps {
  searchParams: Promise<{
    installation_id?: string;
    setup_action?: string;
    state?: string;
  }>;
}

/**
 * GitHub App "Setup URL" target.
 *
 * GitHub redirects here after a user installs/updates the App. We just need
 * to bounce the user back to the dashboard — the `installation` webhook
 * arrives seconds later and writes the DB row.
 *
 * Query params GitHub sends:
 *   - installation_id: numeric GitHub installation id
 *   - setup_action: "install" | "update" | "request"
 *
 * The previous Setup URL pointed at gitautodev.vercel.app/setup, which 404s
 * because that Vercel deployment no longer exists. Point the App's Setup URL
 * at this localhost route (or leave it blank so GitHub falls back to the
 * Homepage URL).
 */
export default async function SetupPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const session = await getServerSession(authOptions);
  const cb = `/dashboard${
    params.installation_id ? `?installed=${params.installation_id}` : ""
  }`;
  if (!session?.accessToken) {
    redirect(`/login?callbackUrl=${encodeURIComponent(cb)}`);
  }
  redirect(cb);
}
