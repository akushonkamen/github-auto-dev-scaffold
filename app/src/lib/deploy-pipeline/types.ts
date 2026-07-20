/**
 * Shared types for the deploy-pipeline module.
 *
 * DiffReport: dry-run result. Lists what WILL be added / skipped / conflict.
 * ApplyReport: apply result. Lists what actually happened per item.
 */

export type RepoRef = { owner: string; repo: string; defaultBranch: string };

export type FileStatus = "new" | "skip" | "conflict";

export interface FileDiff {
  path: string;
  status: FileStatus;
  localSha256: string;
  remoteSha?: string;
}

export interface LabelDiff {
  name: string;
  color: string;
  description?: string;
  status: "new" | "exists-same" | "exists-different";
  remoteColor?: string;
  remoteDescription?: string;
}

export interface VarDiff {
  name: string;
  defaultValue: string;
  status: "new" | "exists-same" | "exists-different";
  remoteValue?: string;
}

export interface ProtectionDiff {
  branch: string;
  status: "new" | "exists";
}

export interface DiffReport {
  repo: RepoRef;
  files: FileDiff[];
  labels: LabelDiff[];
  vars: VarDiff[];
  secrets: { name: string; required: boolean }[];
  branchProtection: ProtectionDiff[];
  // Aggregated counts for UI summary
  counts: {
    filesNew: number;
    filesSkip: number;
    filesConflict: number;
    labelsNew: number;
    labelsExisting: number;
    varsNew: number;
    varsExisting: number;
  };
  // Non-fatal issues — scan continued despite these. e.g. actions/variables
  // API returns 403 for installation tokens; Apply writes via PAT instead.
  warnings?: string[];
}

export type ApplyOutcome =
  | "created"
  | "updated"
  | "skipped"
  | "failed"
  | "unchanged";

export interface ApplyItemReport {
  kind: "file" | "label" | "var" | "secret" | "ruleset";
  key: string;
  outcome: ApplyOutcome;
  message?: string;
}

export interface ApplyReport {
  ok: boolean;
  repo: RepoRef;
  items: ApplyItemReport[];
  counts: {
    created: number;
    updated: number;
    skipped: number;
    failed: number;
    unchanged: number;
  };
}

export interface ApplyOptions {
  /** File paths the user explicitly chose to overwrite (from Configure step). */
  fileOverrides: Set<string>;
  /** LLM_API_KEY value (required). */
  llmKey: string;
  /** CLAUDE_DEV_PAT value (optional). */
  claudePat?: string;
  /** CLAUDE_DEV_PAT_OWNER value (defaults to repo owner). */
  claudePatOwner?: string;
  /** Override vars (key→value). Unspecified vars use defaults. */
  vars: Record<string, string>;
  /** Base branch for protection ruleset (default "dev"). */
  baseBranch?: string;
}
