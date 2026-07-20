import "server-only";
import { loadManifest, readTemplateFile } from "./manifest";
import { fetchFileBytes, putFile } from "./github-contents";
import { loadLabelDefs, upsertLabel } from "./labels";
import { DEFAULT_VARS, setVar } from "./vars";
import { putSecret } from "./secrets";
import { createProtectionRuleset } from "./branch-protection";
import { dryRun } from "./dry-run";
import type {
  ApplyItemReport,
  ApplyOptions,
  ApplyReport,
  RepoRef,
} from "./types";

export { dryRun } from "./dry-run";
export { DEFAULT_VARS } from "./vars";
export type {
  ApplyOptions,
  ApplyReport,
  ApplyItemReport,
  DiffReport,
  FileDiff,
  LabelDiff,
  VarDiff,
  RepoRef,
  ProtectionDiff,
} from "./types";

/**
 * Apply deploy to the target repo. Idempotent: re-running on a repo that
 * was already deployed will mark most items "skipped" (unchanged remote).
 *
 * Failures do NOT abort — we keep going so a single bad file doesn't block
 * the entire pipeline setup. The caller UI shows per-item status.
 *
 * S4: secrets (LLM_API_KEY, CLAUDE_DEV_PAT) are encrypted + sent to GitHub;
 * never logged. The ApplyReport just records outcome, not value.
 */
export async function applyDeploy(
  repoFullName: string,
  token: string,
  options: ApplyOptions,
): Promise<ApplyReport> {
  const [owner, repo] = repoFullName.split("/");
  if (!owner || !repo) {
    throw new Error(`invalid repoFullName: ${repoFullName}`);
  }

  // Re-run dry-run to discover which files need sha (update vs create).
  // We need this for Contents API update path.
  const diff = await dryRun(repoFullName, token);
  if (!diff.ok || !diff.report) {
    throw new Error(`applyDeploy: dry-run failed: ${diff.error ?? "unknown"}`);
  }

  const repoRef = diff.report.repo;
  const manifest = await loadManifest();
  const items: ApplyItemReport[] = [];

  // ── 1. Files ──────────────────────────────────────────────────────
  const fileStatusMap = new Map(diff.report.files.map((f) => [f.path, f]));
  for (const entry of manifest.files) {
    const status = fileStatusMap.get(entry.path);
    if (!status) {
      items.push({ kind: "file", key: entry.path, outcome: "skipped", message: "missing from dry-run" });
      continue;
    }

    if (status.status === "skip") {
      items.push({ kind: "file", key: entry.path, outcome: "skipped" });
      continue;
    }

    if (status.status === "conflict" && !options.fileOverrides.has(entry.path)) {
      items.push({
        kind: "file",
        key: entry.path,
        outcome: "skipped",
        message: "conflict; not in override set",
      });
      continue;
    }

    // status === "new" → create (no sha)
    // status === "conflict" with override → update (need sha)
    let sha: string | undefined;
    if (status.status === "conflict") {
      const fetched = await fetchFileBytes(repoRef, entry.path, token).catch(() => null);
      if (!fetched) {
        items.push({
          kind: "file",
          key: entry.path,
          outcome: "failed",
          message: "could not fetch remote sha for update",
        });
        continue;
      }
      sha = fetched.sha;
    }

    const content = await readTemplateFile(entry);
    const result = await putFile({
      repo: repoRef,
      path: entry.path,
      content,
      commitMessage: commitMessageFor(entry.path, status.status === "new" ? "create" : "update"),
      sha,
      token,
    });

    items.push({
      kind: "file",
      key: entry.path,
      outcome: mapFileOutcome(result.status),
      message: result.message,
    });
  }

  // ── 2. Labels ─────────────────────────────────────────────────────
  const labelDefs = await loadLabelDefs();
  for (const def of labelDefs) {
    const res = await upsertLabel(repoRef, def, token);
    items.push({
      kind: "label",
      key: def.name,
      outcome: res.outcome === "created" ? "created" : res.outcome === "updated" ? "updated" : "failed",
      message: "message" in res ? res.message : undefined,
    });
  }

  // ── 3. Vars ───────────────────────────────────────────────────────
  const mergedVars: Record<string, string> = { ...DEFAULT_VARS, ...options.vars };
  mergedVars.DEV_BASE_BRANCH = options.baseBranch ?? repoRef.defaultBranch;
  mergedVars.CLAUDE_DEV_PAT_OWNER =
    options.claudePatOwner ?? repoRef.owner;

  for (const [name, value] of Object.entries(mergedVars)) {
    // GitHub Actions Variables API rejects empty-string values with 422.
    // Skip empty vars — the pipeline treats absent vars the same as "".
    if (!value) {
      items.push({
        kind: "var",
        key: name,
        outcome: "skipped",
        message: "empty value (GitHub rejects empty-string vars)",
      });
      continue;
    }
    const res = await setVar(repoRef, name, value, token);
    items.push({
      kind: "var",
      key: name,
      outcome: res.outcome === "created" ? "created" : res.outcome === "updated" ? "updated" : "failed",
      message: "message" in res ? res.message : undefined,
    });
  }

  // ── 4. Secrets ────────────────────────────────────────────────────
  // LLM_API_KEY (required). Never echo value in messages.
  const llmKeyRes = await putSecret(repoRef, "LLM_API_KEY", options.llmKey, token);
  items.push({
    kind: "secret",
    key: "LLM_API_KEY",
    outcome: llmKeyRes.outcome === "created" ? "created" : llmKeyRes.outcome === "updated" ? "updated" : "failed",
    message: "message" in llmKeyRes ? llmKeyRes.message : undefined,
  });

  if (options.claudePat) {
    const patRes = await putSecret(repoRef, "CLAUDE_DEV_PAT", options.claudePat, token);
    items.push({
      kind: "secret",
      key: "CLAUDE_DEV_PAT",
      outcome: patRes.outcome === "created" ? "created" : patRes.outcome === "updated" ? "updated" : "failed",
      message: "message" in patRes ? patRes.message : undefined,
    });
  }

  // ── 5. Branch protection ──────────────────────────────────────────
  const baseBranch = options.baseBranch ?? repoRef.defaultBranch;
  const rulesetBranches = uniqueBranches(baseBranch, "main");
  const protectionRes = await createProtectionRuleset(repoRef, rulesetBranches, token);
  items.push({
    kind: "ruleset",
    key: `ruleset(${rulesetBranches.join(",")})`,
    outcome: protectionRes.outcome === "created" ? "created" : "failed",
    message: protectionRes.message,
  });

  // ── Aggregate ─────────────────────────────────────────────────────
  const counts = {
    created: items.filter((i) => i.outcome === "created").length,
    updated: items.filter((i) => i.outcome === "updated").length,
    skipped: items.filter((i) => i.outcome === "skipped").length,
    failed: items.filter((i) => i.outcome === "failed").length,
    unchanged: items.filter((i) => i.outcome === "unchanged").length,
  };

  return {
    ok: counts.failed === 0,
    repo: repoRef,
    items,
    counts,
  };
}

function commitMessageFor(path: string, mode: "create" | "update"): string {
  const tag = mode === "create" ? "create" : "update";
  return `chore(pipeline): ${tag} ${path}\n\nVia GitAutoDev Deploy Wizard.`;
}

function mapFileOutcome(
  status: "created" | "updated" | "skipped-conflict" | "failed",
): ApplyItemReport["outcome"] {
  switch (status) {
    case "created":
      return "created";
    case "updated":
      return "updated";
    case "skipped-conflict":
      return "skipped";
    case "failed":
      return "failed";
  }
}

function uniqueBranches(...branches: string[]): string[] {
  return Array.from(new Set(branches));
}
