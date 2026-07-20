import "server-only";
import { createHash } from "node:crypto";
import { loadManifest, readTemplateFile } from "./manifest";
import { fetchFileBytes, listRepoFiles } from "./github-contents";
import { diffLabels, listRemoteLabels, loadLabelDefs } from "./labels";
import { DEFAULT_VARS, diffVars, listRemoteVars } from "./vars";
import { getBranchProtectionStatus } from "./branch-protection";
import type { DiffReport, RepoRef } from "./types";

const API = "https://api.github.com";

/** Resolve the repo's default branch (fall back to "main" if repo is empty). */
export async function fetchRepoMeta(
  owner: string,
  repo: string,
  token: string,
): Promise<RepoRef> {
  const res = await fetch(`${API}/repos/${owner}/${repo}`, {
    headers: gh(token),
  });
  if (!res.ok) {
    throw new Error(`fetchRepoMeta(${owner}/${repo}) HTTP ${res.status}`);
  }
  const data = (await res.json()) as { default_branch: string };
  return { owner, repo, defaultBranch: data.default_branch ?? "main" };
}

export interface DryRunResult {
  ok: boolean;
  error?: string;
  report?: DiffReport;
}

/**
 * Pure dry-run: read-only GitHub calls + diff against the packaged manifest.
 *
 * Caller supplies an installation_token scoped to the target repo.
 * `repoFullName` is "owner/repo".
 */
export async function dryRun(
  repoFullName: string,
  token: string,
): Promise<DryRunResult> {
  const [owner, repo] = repoFullName.split("/");
  if (!owner || !repo) {
    return { ok: false, error: `invalid repoFullName: ${repoFullName}` };
  }

  try {
    const repoRef = await fetchRepoMeta(owner, repo, token);

    // ── Files ────────────────────────────────────────────────────────
    const manifest = await loadManifest();
    const remoteTree = await listRepoFiles(repoRef, token);

    const fileDiffs = await Promise.all(
      manifest.files.map(async (entry) => {
        const localBytes = await readTemplateFile(entry);
        const localSha256 = sha256Hex(localBytes);
        const remoteMeta = remoteTree.get(entry.path);

        if (!remoteMeta) {
          return { path: entry.path, status: "new" as const, localSha256 };
        }

        // File exists remotely — fetch content + compare hash
        const fetched = await fetchFileBytes(repoRef, entry.path, token);
        const remoteSha256 = fetched ? sha256Hex(fetched.bytes) : undefined;
        const status =
          remoteSha256 && remoteSha256 === localSha256
            ? ("skip" as const)
            : ("conflict" as const);

        return {
          path: entry.path,
          status,
          localSha256,
          remoteSha: remoteMeta.sha,
          remoteSha256,
        };
      }),
    );

    // ── Labels ───────────────────────────────────────────────────────
    const labelDefs = await loadLabelDefs();
    const remoteLabels = await listRemoteLabels(repoRef, token);
    const labelDiffs = diffLabels(labelDefs, remoteLabels);

    // ── Vars ─────────────────────────────────────────────────────────
    // listRemoteVars may 403 for GitHub App installation tokens or for
    // user OAuth tokens lacking `workflow` scope. Degrade gracefully —
    // the scan still reports files/labels, and Apply writes vars via PAT.
    let varsWarning: string | undefined;
    let remoteVars: Map<string, string>;
    try {
      remoteVars = await listRemoteVars(repoRef, token);
    } catch (e) {
      varsWarning = e instanceof Error ? e.message : String(e);
      remoteVars = new Map();
    }
    const varDiffs = diffVars(DEFAULT_VARS, remoteVars);

    // ── Secrets ──────────────────────────────────────────────────────
    // We can't list secret values, but we can list names.
    const secretNames = await listSecretNames(repoRef, token);
    const requiredSecrets = [
      { name: "LLM_API_KEY", required: true },
      { name: "CLAUDE_DEV_PAT", required: false },
      { name: "APP_ID", required: true },
      { name: "APP_PRIVATE_KEY", required: true },
    ].map((s) => ({
      ...s,
      // tag whether secret is already present — UI uses this to skip write
      present: secretNames.has(s.name),
    }));

    // ── Branch protection ────────────────────────────────────────────
    const branches = uniqueBranches(repoRef.defaultBranch, "main");
    const protectionDiffs = await Promise.all(
      branches.map((b) => getBranchProtectionStatus(repoRef, b, token)),
    );

    const report: DiffReport = {
      repo: repoRef,
      files: fileDiffs,
      labels: labelDiffs,
      vars: varDiffs,
      secrets: requiredSecrets.map((s) => ({ name: s.name, required: s.required })),
      branchProtection: protectionDiffs,
      counts: {
        filesNew: fileDiffs.filter((f) => f.status === "new").length,
        filesSkip: fileDiffs.filter((f) => f.status === "skip").length,
        filesConflict: fileDiffs.filter((f) => f.status === "conflict").length,
        labelsNew: labelDiffs.filter((l) => l.status === "new").length,
        labelsExisting: labelDiffs.filter((l) => l.status !== "new").length,
        varsNew: varDiffs.filter((v) => v.status === "new").length,
        varsExisting: varDiffs.filter((v) => v.status !== "new").length,
      },
      ...(varsWarning ? { warnings: [varsWarning] } : {}),
    };

    return { ok: true, report };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

async function listSecretNames(repo: RepoRef, token: string): Promise<Set<string>> {
  const res = await fetch(
    `${API}/repos/${repo.owner}/${repo.repo}/actions/secrets`,
    { headers: gh(token) },
  );
  if (!res.ok) return new Set();
  const data = (await res.json()) as { secrets: { name: string }[] };
  return new Set((data.secrets ?? []).map((s) => s.name));
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

function uniqueBranches(...branches: string[]): string[] {
  return Array.from(new Set(branches));
}

function gh(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "GithubAutoDev-DeployWizard",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}
