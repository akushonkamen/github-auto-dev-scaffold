import "server-only";
import type { RepoRef, VarDiff } from "./types";

const API = "https://api.github.com";

/**
 * 24 default repo variables for the pipeline. Sourced from
 * docs/quickstart-triage.md + CLAUDE.md + .github/workflows/*.yml.
 *
 * `LLM_API_KEY` / `APP_PRIVATE_KEY` etc are secrets, not vars — see secrets.ts.
 * `CLAUDE_DEV_PAT_OWNER` is overridden in Configure step to match the
 * installation owner (set at runtime by index.ts).
 */
export const DEFAULT_VARS: Record<string, string> = {
  // ── Engine core ──────────────────────────────────────────────────────
  ANTHROPIC_BASE_URL: "https://api.deepseek.com/anthropic",
  TRIAGE_MODEL: "deepseek-v4-pro",
  DEVELOP_MODEL: "deepseek-v4-pro",
  SELF_VERIFY_MODEL: "deepseek-v4-pro",
  TEST_MODEL: "deepseek-v4-pro",
  REVIEW_MODEL: "deepseek-v4-pro",
  CLARIFY_MODEL: "deepseek-v4-pro",

  // ── Turn budgets ─────────────────────────────────────────────────────
  DEVELOP_MAX_TURNS: "20",
  SELF_VERIFY_MAX_TURNS: "10",
  TEST_MAX_TURNS: "10",
  REVIEW_MAX_TURNS: "12",
  CLARIFY_MAX_TURNS: "12",

  // ── Time budgets ─────────────────────────────────────────────────────
  DEVELOP_TIME_BUDGET_MIN: "60",
  TEST_TIME_BUDGET_MIN: "30",
  REVIEW_TIME_BUDGET_MIN: "20",
  CLARIFY_TIME_BUDGET_MIN: "30",

  // ── Retry / clarify ──────────────────────────────────────────────────
  CLARIFY_MAX_ROUNDS: "3",
  TEST_RETRY_MAX: "3",
  VERIFY_RETRY_MAX: "3",
  REVIEW_RETRY_MAX: "3",

  // ── Context paths (empty by default; user fills per-repo) ────────────
  DEVELOP_CONTEXT_PATHS: "",
  SELF_VERIFY_CONTEXT_PATHS: "",
  TEST_CONTEXT_PATHS: "",
  REVIEW_CONTEXT_PATHS: "",
};

/** Vars that should NOT be deployed by default (tenant-specific). */
export const RUNTIME_VARS: string[] = ["DEV_BASE_BRANCH", "CLAUDE_DEV_PAT_OWNER"];

export async function listRemoteVars(
  repo: RepoRef,
  token: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let page = 1;
  while (true) {
    const url = `${API}/repos/${repo.owner}/${repo.repo}/actions/variables?per_page=100&page=${page}`;
    const res = await fetch(url, { headers: gh(token) });
    if (!res.ok) {
      throw new Error(`listRemoteVars HTTP ${res.status}`);
    }
    const data = (await res.json()) as {
      variables: { name: string; value: string }[];
    };
    for (const v of data.variables ?? []) {
      map.set(v.name, v.value);
    }
    if ((data.variables?.length ?? 0) < 100) break;
    page += 1;
    if (page > 20) break;
  }
  return map;
}

export function diffVars(
  defaults: Record<string, string>,
  remote: Map<string, string>,
): VarDiff[] {
  const out: VarDiff[] = [];
  for (const [name, defaultValue] of Object.entries(defaults)) {
    const r = remote.get(name);
    if (r === undefined) {
      out.push({ name, defaultValue, status: "new" });
    } else if (r === defaultValue) {
      out.push({ name, defaultValue, status: "exists-same", remoteValue: r });
    } else {
      out.push({ name, defaultValue, status: "exists-different", remoteValue: r });
    }
  }
  return out;
}

export async function setVar(
  repo: RepoRef,
  name: string,
  value: string,
  token: string,
): Promise<{ outcome: "created" | "updated"; message?: string } | { outcome: "failed"; message: string }> {
  // Try create first; 422 means already exists → update.
  const createRes = await fetch(
    `${API}/repos/${repo.owner}/${repo.repo}/actions/variables`,
    {
      method: "POST",
      headers: gh(token),
      body: JSON.stringify({ name, value }),
    },
  );
  if (createRes.status === 201 || createRes.status === 204) return { outcome: "created" };
  // GitHub returns 409 (not 422) when the variable already exists. Both
  // statuses should trigger the PATCH update path.
  if (createRes.status === 422 || createRes.status === 409) {
    const patchRes = await fetch(
      `${API}/repos/${repo.owner}/${repo.repo}/actions/variables/${encodeURIComponent(name)}`,
      {
        method: "PATCH",
        headers: gh(token),
        body: JSON.stringify({ name, value }),
      },
    );
    if (patchRes.ok) return { outcome: "updated" };
    return {
      outcome: "failed",
      message: `PATCH var HTTP ${patchRes.status}: ${(await safeText(patchRes)).slice(0, 160)}`,
    };
  }
  return {
    outcome: "failed",
    message: `POST var HTTP ${createRes.status}: ${(await safeText(createRes)).slice(0, 160)}`,
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
