"use server";

import { cookies } from "next/headers";

const COOKIE_NAME = "gitautodev_active_installation";

/**
 * Set the active installation for the current user.
 *
 * Writes a 1-year httpOnly cookie `gitautodev_active_installation` so the
 * dashboard and future pages remember which installation the user is working
 * with. The cookie is set at domain scope (no specific path restriction other
 * than `/`) so it's available to all pages.
 *
 * Security properties:
 *  - httpOnly: true  — not readable from JS (XSS mitigation)
 *  - sameSite: "lax" — sent on top-level navigations from GitHub
 *  - secure: true    — only sent over HTTPS (production)
 *    (Next.js cookies() handles secure automatically in production)
 *
 * @param installationDbId - The DB installations.id to set as active.
 */
export async function setActiveInstallation(
  installationDbId: number,
): Promise<{ ok: true }> {
  const oneYearSeconds = 365 * 24 * 60 * 60;

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, String(installationDbId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: oneYearSeconds,
    path: "/",
  });

  return { ok: true };
}
