import "server-only";
import { cookies } from "next/headers";

/**
 * Active-installation cookie (Issue #6 "switching" UX).
 *
 * The dashboard lists every installation the user can access; clicking one
 * sets a long-lived cookie so the top nav can deep-link to the most
 * recently used installation. This is purely a UX affordance — every
 * server route still verifies access via the GitHub /user/installations
 * API on read, never trusts the cookie alone.
 */

const COOKIE_NAME = "gitautodev_active_installation";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // 1 year

export async function getActiveInstallationDbId(): Promise<number | null> {
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export async function setActiveInstallationDbId(dbId: number): Promise<void> {
  const store = await cookies();
  store.set({
    name: COOKIE_NAME,
    value: String(dbId),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearActiveInstallation(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

export const ACTIVE_INSTALLATION_COOKIE = COOKIE_NAME;
