/**
 * GitHub webhook event routing table (PRD §4.1).
 *
 * Two lanes:
 *  - `SYNC_EVENTS`: handled inline by the webhook route — installation
 *    metadata changes. Cheap to process, no LLM calls, and downstream
 *    events depend on `tenants` / `installations` rows existing, so we
 *    cannot afford the queue round-trip.
 *  - `ASYNC_EVENTS`: enqueued to QStash. The actual engine trigger
 *    (workflow_dispatch on the user's repo) lives in Issue #5; here we
 *    just hand off so Vercel's function-timeout (PRD §8 R6) never bites.
 *
 * Any event not in either list is acknowledged as `ignored` so GitHub's
 * webhook retry policy doesn't fire on events we don't care about.
 */

export const SYNC_EVENTS = [
  "installation",
  "installation_repositories",
] as const;

export const ASYNC_EVENTS = [
  "issues",
  "issue_comment",
  "pull_request",
  "pull_request_review",
  "label",
] as const;

export type SyncEvent = (typeof SYNC_EVENTS)[number];
export type AsyncEvent = (typeof ASYNC_EVENTS)[number];

export function isSyncEvent(event: string): event is SyncEvent {
  return (SYNC_EVENTS as readonly string[]).includes(event);
}

export function isAsyncEvent(event: string): event is AsyncEvent {
  return (ASYNC_EVENTS as readonly string[]).includes(event);
}

/**
 * Refine a top-level event name + action into the action-aware key the
 * worker (Issue #5) will switch on, e.g. `issues.opened`.
 * Returns `null` for actions we don't enqueue (e.g. `issues.closed`).
 */
export function asyncEventKey(
  event: AsyncEvent,
  action: string | undefined,
): string | null {
  if (!action) return null;
  switch (event) {
    case "issues":
      // Module 2 entry point — only `opened` triggers triage. Other
      // actions (`closed`, `reopened`) are observed but ignored for v1.
      if (action === "opened" || action === "reopened" || action === "labeled") {
        return `issues.${action}`;
      }
      return null;
    case "issue_comment":
      return action === "created" ? `issue_comment.${action}` : null;
    case "pull_request":
      // Module 7/8 entry points. `labeled` is the in-review trigger.
      if (
        action === "opened" ||
        action === "ready_for_review" ||
        action === "labeled"
      ) {
        return `pull_request.${action}`;
      }
      return null;
    case "pull_request_review":
      return action === "submitted" ? `pull_request_review.${action}` : null;
    case "label":
      // Label lifecycle — used to mirror `pipeline-fix` etc. into Postgres.
      if (action === "created" || action === "deleted") {
        return `label.${action}`;
      }
      return null;
    default:
      return null;
  }
}
