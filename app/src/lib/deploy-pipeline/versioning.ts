import "server-only";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { installations } from "@/db/schema";
import { applyDeploy } from "./index";

const DEFAULT_VERSION = "v0.1.0";

export interface PipelineVersion {
  current: string;
  latest: string;
  needsUpgrade: boolean;
}

/**
 * Read pipeline-bundle/version.txt (written by pack-pipeline-template.mjs).
 * Falls back to "v0.1.0" when the file is missing so the dashboard never
 * breaks on a fresh checkout that hasn't run `pnpm pack:pipeline` yet.
 */
export async function readTemplateVersion(): Promise<string> {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const versionPath = join(here, "..", "..", "..", "resources", "pipeline-template", "version.txt");
    const raw = await readFile(versionPath, "utf8");
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : DEFAULT_VERSION;
  } catch {
    return DEFAULT_VERSION;
  }
}

/**
 * Compare two semver-like strings ("vX.Y.Z"). Returns negative if a<b,
 * 0 if equal, positive if a>b. Tolerates missing "v" prefix and suffixes
 * ("-rc.1"). Avoids pulling in the `semver` package for a 3-segment
 * integer comparison.
 */
export function compareVersions(a: string, b: string): number {
  const norm = (v: string) => v.trim().replace(/^v/i, "").split("-")[0].split(".");
  const pa = norm(a);
  const pb = norm(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const ai = Number.parseInt(pa[i] ?? "0", 10);
    const bi = Number.parseInt(pb[i] ?? "0", 10);
    if (Number.isNaN(ai) || Number.isNaN(bi)) return String(pa[i] ?? "").localeCompare(String(pb[i] ?? ""));
    if (ai !== bi) return ai - bi;
  }
  return 0;
}

/**
 * Compare the installation's recorded pipeline_version against the latest
 * template version. Used by the dashboard to decide whether to render the
 * upgrade CTA.
 */
export async function checkUpgradeNeeded(
  installationDbId: number,
): Promise<PipelineVersion> {
  const rows = await db
    .select({ pipelineVersion: installations.pipelineVersion })
    .from(installations)
    .where(eq(installations.id, installationDbId))
    .limit(1);
  const current = rows[0]?.pipelineVersion ?? DEFAULT_VERSION;
  const latest = await readTemplateVersion();
  return {
    current,
    latest,
    needsUpgrade: compareVersions(current, latest) < 0,
  };
}

/**
 * Push the latest pipeline bundle to the installation's repo + bump the
 * recorded pipeline_version + open a tracking Issue. Used by the
 * /api/installations/[id]/upgrade-pipeline route.
 *
 * Callers MUST have already verified the user has access to the installation
 * (resolveAuthorized() in deploy/actions.ts).
 */
export interface UpgradeResult {
  ok: boolean;
  newVersion: string;
  error?: string;
}

export async function upgradePipeline(
  installationDbId: number,
  repoFullName: string,
  token: string,
  options: {
    llmKey: string;
    claudePat?: string;
    claudePatOwner?: string;
    baseBranch?: string;
    vars?: Record<string, string>;
  },
): Promise<UpgradeResult> {
  const latest = await readTemplateVersion();
  try {
    const report = await applyDeploy(repoFullName, token, {
      llmKey: options.llmKey,
      claudePat: options.claudePat?.trim() || undefined,
      claudePatOwner: options.claudePatOwner?.trim() || undefined,
      baseBranch: options.baseBranch?.trim() || undefined,
      vars: options.vars ?? {},
      fileOverrides: new Set(),
    });
    if (!report.ok) {
      return { ok: false, newVersion: latest, error: "deploy reported failures" };
    }

    await db
      .update(installations)
      .set({ pipelineVersion: latest })
      .where(eq(installations.id, installationDbId));

    await createUpgradeIssue(repoFullName, token, latest);

    return { ok: true, newVersion: latest };
  } catch (err) {
    return {
      ok: false,
      newVersion: latest,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Open an Issue on the target repo announcing the upgrade. Non-fatal —
 * a failure to open the Issue does NOT roll back the deploy.
 */
async function createUpgradeIssue(
  repoFullName: string,
  token: string,
  newVersion: string,
): Promise<void> {
  const [owner, repo] = repoFullName.split("/");
  if (!owner || !repo) return;
  const url = `https://api.github.com/repos/${owner}/${repo}/issues`;
  const body = {
    title: `chore(pipeline): upgraded to ${newVersion}`,
    body: [
      `GitAutoDev Deploy Wizard pushed pipeline bundle \`${newVersion}\`.`,
      "",
      "What changed is recorded in the repo's commit history under `.github/`.",
      "If a workflow breaks, roll back the commits or open an Issue on the GitAutoDev dashboard.",
    ].join("\n"),
    labels: ["pipeline-upgrade"],
  };
  try {
    await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify(body),
    });
  } catch {
    // Non-fatal — dashboard still reports the new version.
  }
}
