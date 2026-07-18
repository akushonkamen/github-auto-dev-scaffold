import "server-only";
import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/db/client";
import { installations, tenants } from "@/db/schema";

/**
 * Sync handlers for the `installation` and `installation_repositories`
 * event families (PRD §4.1 SYNC_EVENTS).
 *
 * v1 scope:
 *  - one installation = one tenant row, keyed by GitHub account id
 *  - one installation = one row in `installations` (the schema is
 *    intentionally unique on `installation_id`; multi-repo installations
 *    collapse to the latest repo for now — full multi-repo support is
 *    Issue #6 scope).
 *
 * Soft-delete on uninstall (PRD §6 audit-trail requirement): we set
 * `uninstalled_at = now()` instead of deleting the row, so historical
 * `runs` keep their FK target.
 */

type InstallationEventPayload = {
  action: string;
  installation: {
    id: number;
    account?: { id: number; login?: string } | null;
  };
  // `installation_repositories` events carry these arrays.
  repositories_added?: { full_name: string }[];
  repositories_removed?: { full_name: string }[];
  // `installation` events on first install carry this list.
  repositories?: { full_name: string }[];
};

type RepoSelection = {
  installationId: number;
  accountGithubId: number;
  accountLogin: string;
  repoFullName: string | null;
};

function pickRepo(payload: InstallationEventPayload): string | null {
  const added =
    payload.repositories_added && payload.repositories_added.length > 0
      ? payload.repositories_added[0].full_name
      : null;
  if (added) return added;
  const initial =
    payload.repositories && payload.repositories.length > 0
      ? payload.repositories[0].full_name
      : null;
  return initial ?? null;
}

function resolveSelection(
  payload: InstallationEventPayload,
): RepoSelection | null {
  const installationId = payload.installation?.id;
  const account = payload.installation?.account;
  if (
    installationId === undefined ||
    !account ||
    typeof account.id !== "number"
  ) {
    return null;
  }
  return {
    installationId,
    accountGithubId: account.id,
    accountLogin: account.login ?? String(account.id),
    repoFullName: pickRepo(payload),
  };
}

/**
 * Upsert `tenants` + `installations` for an `installation.created` /
 * `installation_repositories.added` event. Idempotent — safe to retry.
 */
export async function upsertInstallationFromEvent(
  payload: InstallationEventPayload,
): Promise<{ installationDbId: number | null }> {
  const selection = resolveSelection(payload);
  if (!selection) return { installationDbId: null };

  await db
    .insert(tenants)
    .values({
      githubId: selection.accountGithubId,
      githubLogin: selection.accountLogin,
      plan: "free",
    })
    .onConflictDoUpdate({
      target: tenants.githubId,
      set: { githubLogin: selection.accountLogin },
    });

  const tenant = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.githubId, selection.accountGithubId))
    .limit(1);
  const tenantId = tenant[0]?.id;
  if (tenantId === undefined) {
    // onConflictDoUpdate should have produced the row; defensive guard.
    return { installationDbId: null };
  }

  if (!selection.repoFullName) {
    // installation created but no repos selected yet — keep the row so
    // subsequent `installation_repositories.added` events find the tenant.
    const existing = await db
      .select({ id: installations.id })
      .from(installations)
      .where(eq(installations.installationId, selection.installationId))
      .limit(1);
    if (existing[0]) return { installationDbId: existing[0].id };
    return { installationDbId: null };
  }

  const inserted = await db
    .insert(installations)
    .values({
      installationId: selection.installationId,
      tenantId,
      repoFullName: selection.repoFullName,
    })
    .onConflictDoUpdate({
      target: installations.installationId,
      set: {
        repoFullName: selection.repoFullName,
        uninstalledAt: null,
      },
    })
    .returning({ id: installations.id });

  return { installationDbId: inserted[0]?.id ?? null };
}

/**
 * Soft-delete on `installation.deleted` / `installation_repositories.removed`.
 *
 * `installation.deleted` removes the entire installation → soft-delete the
 * row. `installation_repositories.removed` only unlinks specific repos; we
 * soft-delete only if the row's current repo was the one removed (best
 * effort for v1's single-repo assumption).
 */
export async function softDeleteInstallationFromEvent(
  payload: InstallationEventPayload,
): Promise<{ matched: boolean }> {
  const installationId = payload.installation?.id;
  if (installationId === undefined) return { matched: false };

  if (payload.action === "deleted") {
    await db
      .update(installations)
      .set({ uninstalledAt: new Date() })
      .where(
        and(
          eq(installations.installationId, installationId),
          isNull(installations.uninstalledAt),
        ),
      );
    return { matched: true };
  }

  // installation_repositories.removed
  const removed = payload.repositories_removed?.[0]?.full_name;
  if (!removed) return { matched: false };

  const current = await db
    .select({
      id: installations.id,
      repoFullName: installations.repoFullName,
    })
    .from(installations)
    .where(
      and(
        eq(installations.installationId, installationId),
        isNull(installations.uninstalledAt),
      ),
    )
    .limit(1);
  if (!current[0] || current[0].repoFullName !== removed) {
    return { matched: false };
  }
  await db
    .update(installations)
    .set({ uninstalledAt: new Date() })
    .where(eq(installations.id, current[0].id));
  return { matched: true };
}
