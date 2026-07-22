import "server-only";
import type { ProtectionDiff, RepoRef } from "./types";

const API = "https://api.github.com";

/**
 * Check whether a branch already has a protection ruleset attached.
 * Uses the legacy branch-protection GET (works without admin push).
 */
export async function getBranchProtectionStatus(
  repo: RepoRef,
  branch: string,
  token: string,
): Promise<ProtectionDiff> {
  const res = await fetch(
    `${API}/repos/${repo.owner}/${repo.repo}/branches/${encodeURIComponent(branch)}/protection`,
    { headers: gh(token) },
  );
  if (res.status === 200) return { branch, status: "exists" };
  if (res.status === 404 || res.status === 409) return { branch, status: "new" };
  // 403 — token lacks admin scope; surface as "exists" so user can investigate
  // manually rather than blindly overwriting.
  if (res.status === 403) return { branch, status: "exists" };
  throw new Error(`getBranchProtectionStatus HTTP ${res.status}`);
}

/**
 * Create a ruleset covering dev (and main if differs from dev).
 *
 * Uses the modern `POST /repos/.../rulesets` API which is more flexible
 * than the legacy branch-protection PUT.
 *
 * Rules:
 *   - required_status_checks: CI must pass (parameterized at first run by
 *     GitHub — set context="ci" as placeholder; GitHub will pick up
 *     actual check names once workflows run).
 *   - pull_request: required_reviews=1, require_code_owner_reviews=true,
 *     dismiss_stale_reviews=true
 *   - deletion: block
 *   - non_fast_forward: block
 *   - required_linear_history: off (configure in repo settings if wanted)
 *
 * S7 red line is enforced via audit comment + pipeline-fix label, NOT via
 * enforce_admins — we leave admin override available so the maintainer can
 * rescue a stuck pipeline.
 */
export async function createProtectionRuleset(
  repo: RepoRef,
  branches: string[],
  token: string,
): Promise<{ outcome: "created" | "failed"; message?: string }> {
  const body = {
    name: "GitAutoDev pipeline protection",
    target: "branch",
    enforcement: "active",
    conditions: {
      ref_name: {
        include: branches.map((b) => `refs/heads/${b}`),
        exclude: [],
      },
    },
    rules: [
      { type: "deletion" },
      { type: "non_fast_forward" },
      {
        type: "pull_request",
        parameters: {
          required_approving_review_count: 1,
          dismiss_stale_reviews_on_push: true,
          require_code_owner_review: true,
          require_last_push_approval: false,
          required_review_thread_resolution: false,
        },
      },
      // S7 escape hatch: bypass actor "GitAutoDev Deploy" lets the
      // maintainer push pipeline fixes without a PR. Created as an
      // integration-app reference; GitHub will match by name on subsequent
      // direct pushes tagged with that actor. This does NOT weaken S2 —
      // only maintainers with admin rights can tag the bypass actor.
      // NOTE: required_status_checks omitted — GitHub rejects an empty
      // required_status_checks array with 422 "Expected at least 1
      // elements, got 0". Once CI workflow names are known, add them
      // explicitly via a future Configure step.
    ],
    bypass_actors: [
      {
        actor_type: "Integration",
        actor_id: "GitAutoDev Deploy",
        bypass_mode: "always",
      },
    ],
  };

  const res = await fetch(`${API}/repos/${repo.owner}/${repo.repo}/rulesets`, {
    method: "POST",
    headers: gh(token),
    body: JSON.stringify(body),
  });
  if (res.status === 201 || res.status === 200) return { outcome: "created" };
  const body_text = (await safeText(res)).slice(0, 200);
  const hint =
    res.status === 403 || res.status === 422
      ? " (fine-grained PAT needs Administration: Read and write; classic PAT needs admin repo perms)"
      : "";
  return {
    outcome: "failed",
    message: `ruleset HTTP ${res.status}: ${body_text}${hint}`,
  };
}

function gh(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "GithubAutoDev-DeployWizard",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
