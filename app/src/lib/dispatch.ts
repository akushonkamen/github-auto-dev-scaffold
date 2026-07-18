import "server-only";

/**
 * Map an action-aware event key (from `asyncEventKey`) to a target workflow
 * file on the user's installation repo (PRD §4.1 ASYNC_EVENTS).
 *
 * v1 maps every key to a fixed workflow filename under `.github/workflows/`.
 * The repo's branch protection (S7) ensures the file exists and is the
 * dogfooded one — same engine that powers the scaffold repo.
 *
 * `null` means "observed but no dispatch" (e.g. `label.created` only matters
 * for state sync — no workflow runs on it).
 */
export function eventToWorkflow(eventKey: string): string | null {
  switch (eventKey) {
    case "issues.opened":
    case "issues.reopened":
    case "issues.labeled":
      return "triage-issue.yml";
    case "issue_comment.created":
      return "clarify-loop.yml";
    case "pull_request.opened":
    case "pull_request.ready_for_review":
      return "pr-lifecycle.yml";
    case "pull_request.labeled":
      // pr-lifecycle applies labels; downstream workflows fire on those labels.
      return "pr-lifecycle.yml";
    case "pull_request_review.submitted":
      return "review.yml";
    case "label.created":
    case "label.deleted":
      return null;
    default:
      return null;
  }
}

/**
 * Issue number / PR number extraction — these are the only inputs the target
 * workflow needs (its own `gh issue view` / `gh pr view` pulls the rest).
 */
type WorkflowInputs = {
  issue_number?: number;
  pr_number?: number;
};

function extractInputs(
  eventKey: string,
  payload: Record<string, unknown>,
): WorkflowInputs {
  const issueNumber = readNumber(payload.issue, "number");
  const prNumber = readNumber(payload.pull_request, "number");
  const inputs: WorkflowInputs = {};
  if (eventKey.startsWith("issues.") || eventKey.startsWith("issue_comment.")) {
    if (issueNumber !== undefined) inputs.issue_number = issueNumber;
  }
  if (eventKey.startsWith("pull_request")) {
    if (prNumber !== undefined) inputs.pr_number = prNumber;
  }
  return inputs;
}

function readNumber(obj: unknown, key: string): number | undefined {
  if (typeof obj !== "object" || obj === null) return undefined;
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === "number" ? v : undefined;
}

/**
 * Dispatch `workflow_dispatch` on the target repo's `dev` branch. The target
 * repo's branch protection (S7) guarantees `dev` exists.
 *
 * @returns `{ ok: true }` on 204 from GitHub; throws on non-2xx so the worker
 *          can record `failed` and let QStash retry.
 */
export async function dispatchWorkflow(args: {
  installationToken: string;
  repoFullName: string;
  workflowFile: string;
  eventKey: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  const inputs = extractInputs(args.eventKey, args.payload);
  const res = await fetch(
    `https://api.github.com/repos/${args.repoFullName}/actions/workflows/${args.workflowFile}/dispatches`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `token ${args.installationToken}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ ref: "dev", inputs }),
    },
  );
  if (!res.ok) {
    // 404 usually means the workflow file isn't on the target repo yet
    // (e.g. user's repo is missing dogfooded .github/workflows/). 401/403
    // means the installation token lacks `actions: write`. Either way we
    // surface the status; the worker decides retry vs. fail.
    throw new Error(
      `workflow_dispatch failed: status=${res.status} repo=${args.repoFullName} workflow=${args.workflowFile}`,
    );
  }
}
