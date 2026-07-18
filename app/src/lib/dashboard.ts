import "server-only";
import { count, desc, eq, isNull } from "drizzle-orm";

import { db } from "@/db/client";
import { installations, runs } from "@/db/schema";

// ── Types ───────────────────────────────────────────────────────────────────

/** Raw installation object from GET /user/installations (GitHub API). */
export interface GitHubInstallation {
  id: number;
  account: {
    login: string;
    id: number;
    type: "Organization" | "User";
  };
  repository_selection: "all" | "selected";
  target_type: "Organization" | "User";
}

/** Installation enriched with DB data for the dashboard list. */
export interface DashboardInstallation {
  id: number; // GitHub installation_id
  accountLogin: string;
  accountType: string;
  accountId: number;
  // DB-derived fields (nullable = missing DB row)
  repoFullName: string | null;
  runsCount: number;
  installedAt: Date | null;
}

/** Installation detail view — metadata + recent runs. */
export interface InstallationDetail {
  id: number;
  accountLogin: string;
  accountType: string;
  accountId: number;
  repoFullName: string | null;
  installedAt: Date | null;
  repositorySelection: "all" | "selected";
  recentRuns: {
    id: number;
    issueNumber: number;
    prNumber: number | null;
    currentStage: string | null;
    status: string | null;
    startedAt: Date | null;
  }[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const INSTALLATIONS_API = "https://api.github.com/user/installations";

/**
 * Fetch all installations accessible to the authenticated user from GitHub API.
 */
async function fetchUserInstallations(
  accessToken: string,
): Promise<GitHubInstallation[]> {
  const res = await fetch(INSTALLATIONS_API, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "GithubAutoDev",
    },
  });
  if (!res.ok) {
    throw new Error(
      `GitHub API error (GET /user/installations): ${res.status} ${res.statusText}`,
    );
  }
  const data = (await res.json()) as {
    installations: GitHubInstallation[];
  };
  return data.installations;
}

/**
 * Look up DB rows for a set of GitHub installation IDs.
 * Returns a Map keyed by installation_id for fast cross-reference.
 */
async function getInstallationDbMap(
  installationIds: number[],
): Promise<
  Map<
    number,
    { repoFullName: string; installedAt: Date | null; id: number }
  >
> {
  if (installationIds.length === 0) return new Map();

  // Query active installations and cross-reference by GitHub installation_id.
  // Client-side filter is fine here — a typical user has < 100 installations.
  const allActive = await db
    .select({
      installationId: installations.installationId,
      id: installations.id,
      repoFullName: installations.repoFullName,
      installedAt: installations.installedAt,
    })
    .from(installations)
    .where(isNull(installations.uninstalledAt));

  const idSet = new Set(installationIds);
  const map = new Map<
    number,
    { repoFullName: string; installedAt: Date | null; id: number }
  >();
  for (const row of allActive) {
    if (idSet.has(row.installationId)) {
      map.set(row.installationId, {
        repoFullName: row.repoFullName,
        installedAt: row.installedAt,
        id: row.id,
      });
    }
  }
  return map;
}

/**
 * Count runs per installation (via the DB `installations.id` FK).
 */
async function getRunsCountByInstallation(
  dbInstallationIds: number[],
): Promise<Map<number, number>> {
  if (dbInstallationIds.length === 0) return new Map();

  const rows = await db
    .select({
      installationDbId: runs.installationId,
      count: count(),
    })
    .from(runs)
    .groupBy(runs.installationId);

  const map = new Map<number, number>();
  for (const row of rows) {
    map.set(row.installationDbId, row.count);
  }
  return map;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Get installations for the dashboard list, enriched with DB data.
 *
 * Cross-references GitHub API `/user/installations` with the local
 * `installations` table. Installations missing from the DB are still shown
 * with a "Webhook pending" indicator.
 */
export async function getDashboardInstallations(
  accessToken: string,
): Promise<DashboardInstallation[]> {
  const ghInstallations = await fetchUserInstallations(accessToken);
  if (ghInstallations.length === 0) return [];

  const ghIds = ghInstallations.map((i) => i.id);
  const dbMap = await getInstallationDbMap(ghIds);

  // Build a map: installation.id → DB installation id
  const dbIdToGhId = new Map<number, number>();
  for (const ghId of ghIds) {
    const db = dbMap.get(ghId);
    if (db) dbIdToGhId.set(db.id, ghId);
  }

  // Count runs for all found DB installations
  const dbIds = [...dbIdToGhId.keys()];
  const runsCountMap = await getRunsCountByInstallation(dbIds);

  return ghInstallations.map((gh) => {
    const db = dbMap.get(gh.id);
    const runsCount = db ? (runsCountMap.get(db.id) ?? 0) : 0;
    return {
      id: gh.id,
      accountLogin: gh.account.login,
      accountType: gh.account.type,
      accountId: gh.account.id,
      repoFullName: db?.repoFullName ?? null,
      runsCount,
      installedAt: db?.installedAt ?? null,
    };
  });
}

/**
 * Verify the authenticated user can access a specific installation (IDOR guard).
 *
 * Re-fetches `/user/installations` and checks that the requested installation
 * ID appears in the user's accessible list.
 */
export async function verifyInstallationAccess(
  accessToken: string,
  installationId: number,
): Promise<boolean> {
  try {
    const installations = await fetchUserInstallations(accessToken);
    return installations.some((i) => i.id === installationId);
  } catch {
    return false;
  }
}

/**
 * Get installation detail for the detail page.
 *
 * Returns the installation metadata (from both GitHub API and DB) as well as
 * the last 10 runs. Callers MUST verify access via `verifyInstallationAccess`
 * before displaying this data (IDOR protection).
 *
 * Throws if the installation is not found in either source.
 */
export async function getInstallationDetail(
  accessToken: string,
  installationId: number,
): Promise<InstallationDetail> {
  // Fetch raw GitHub data for this installation
  const allInstallations = await fetchUserInstallations(accessToken);
  const gh = allInstallations.find((i) => i.id === installationId);
  if (!gh) {
    throw new Error(`Installation ${installationId} not found or not accessible`);
  }

  // Cross-reference with DB
  const dbMap = await getInstallationDbMap([installationId]);
  const dbEntry = dbMap.get(installationId);

  // Last 10 runs
  let recentRuns: InstallationDetail["recentRuns"] = [];
  if (dbEntry) {
    const rows = await db
      .select({
        id: runs.id,
        issueNumber: runs.issueNumber,
        prNumber: runs.prNumber,
        currentStage: runs.currentStage,
        status: runs.status,
        startedAt: runs.startedAt,
      })
      .from(runs)
      .where(eq(runs.installationId, dbEntry.id))
      .orderBy(desc(runs.startedAt))
      .limit(10);

    recentRuns = rows;
  }

  return {
    id: gh.id,
    accountLogin: gh.account.login,
    accountType: gh.account.type,
    accountId: gh.account.id,
    repoFullName: dbEntry?.repoFullName ?? null,
    installedAt: dbEntry?.installedAt ?? null,
    repositorySelection: gh.repository_selection,
    recentRuns,
  };
}
