#!/usr/bin/env node
/**
 * Notion Sync — mirror GitHub Issue label/status changes to a Notion database.
 *
 * Reads event context from environment variables (set by the caller workflow):
 *   NOTION_API_KEY      — Notion integration token
 *   NOTION_DATABASE_ID  — target Notion database ID
 *   LABEL_NAME          — the label being added or removed
 *   ISSUE_NUMBER        — GitHub issue number
 *   EVENT_TYPE          — labeled | unlabeled | opened | closed | reopened
 *
 * For labeled/unlabeled events: applies a delta to the page's Labels
 * multi_select and recomputes the Status via computeStatusLabel().
 *
 * Security (PRD §7 S4): never prints tokens, API keys, or environment values.
 */

import { Client } from "@notionhq/client";

// ---------------------------------------------------------------------------
// Notion client (lazy-init)
// ---------------------------------------------------------------------------
let _notion = null;
function notion() {
  if (!_notion) {
    _notion = new Client({ auth: process.env.NOTION_API_KEY });
  }
  return _notion;
}

// ---------------------------------------------------------------------------
// Label → Status priority map (highest-priority label wins).
// Labels not listed here are ignored for Status computation.
// ---------------------------------------------------------------------------
const LABEL_STATUS_MAP = {
  "triage":            { status: "Triage",         priority: 10 },
  "needs-clarify":     { status: "Clarifying",     priority: 20 },
  "needs-ralph":       { status: "Ralph Review",   priority: 25 },
  "accepted":          { status: "Accepted",       priority: 30 },
  "accepted-by-claude":{ status: "Accepted",       priority: 30 },
  "design-approved":   { status: "Design Done",    priority: 35 },
  "in-development":    { status: "In Development", priority: 40 },
  "verifying":         { status: "Verifying",      priority: 50 },
  "verified":          { status: "Verified",       priority: 60 },
  "verify:failed":     { status: "Verify Failed",  priority: 55 },
  "testing":           { status: "Testing",        priority: 70 },
  "ready-for-pr":      { status: "Ready for PR",   priority: 80 },
  "in-review":         { status: "In Review",      priority: 90 },
  "merged":            { status: "Merged",         priority: 100 },
  "rejected":          { status: "Rejected",       priority: 100 },
  "stage:failed":      { status: "Failed",         priority: 100 },
};

/**
 * Compute the Status label from the current label set — the highest-priority
 * label in LABEL_STATUS_MAP wins.
 */
function computeStatusLabel(labels) {
  let best = { status: "Backlog", priority: 0 };
  for (const name of labels) {
    const entry = LABEL_STATUS_MAP[name];
    if (entry && entry.priority > best.priority) {
      best = entry;
    }
  }
  return best.status;
}

/**
 * Apply a label add or remove to the current label name array.
 * Returns a new array (does not mutate input).
 */
function applyLabelDelta(currentLabels, eventType, labelName) {
  const set = new Set(currentLabels);
  if (eventType === "labeled") {
    set.add(labelName);
  } else if (eventType === "unlabeled") {
    set.delete(labelName);
  }
  return [...set];
}

// ---------------------------------------------------------------------------
// Notion database helpers
// ---------------------------------------------------------------------------

/**
 * Find the Notion page for the given GitHub issue number.
 * Returns the page object or null if not found.
 */
async function findPageByIssueNumber(issueNumber) {
  const dbId = process.env.NOTION_DATABASE_ID;
  const response = await notion().databases.query({
    database_id: dbId,
    filter: {
      property: "Issue Number",
      number: { equals: issueNumber },
    },
    page_size: 1,
  });
  return response.results[0] || null;
}

/**
 * Update the Labels multi_select and Status select on a Notion page.
 */
async function updatePageLabels(pageId, labels, status) {
  await notion().pages.update({
    page_id: pageId,
    properties: {
      Labels: {
        type: "multi_select",
        multi_select: labels.map((name) => ({ name })),
      },
      Status: {
        type: "select",
        select: { name: status },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

/**
 * Handle a label event (labeled / unlabeled).
 * Reads LABEL_NAME from the environment — this was the bug fixed in Issue #38:
 * LABEL_NAME was never wired through action.yml, so labelName was always "".
 */
async function handleLabelEvent(issueNumber, eventType, labelName) {
  if (!labelName) {
    console.log(`[notion-sync] Skipping ${eventType} event: LABEL_NAME is empty`);
    return;
  }

  console.log(`[notion-sync] ${eventType} "${labelName}" on issue #${issueNumber}`);

  const page = await findPageByIssueNumber(issueNumber);
  if (!page) {
    console.log(`[notion-sync] No Notion page found for issue #${issueNumber} — skipping`);
    return;
  }

  // Read current labels from the Notion page.
  const currentLabels =
    page.properties?.Labels?.multi_select?.map((opt) => opt.name) || [];

  // Apply the delta.
  const updatedLabels = applyLabelDelta(currentLabels, eventType, labelName);

  // Recompute Status from the updated label set.
  const status = computeStatusLabel(updatedLabels);

  await updatePageLabels(page.id, updatedLabels, status);
  console.log(
    `[notion-sync] Updated page ${page.id}: Labels=[${updatedLabels.join(", ")}] Status="${status}"`
  );
}

// ---------------------------------------------------------------------------
// Main — dispatch on event type
// ---------------------------------------------------------------------------
async function main() {
  const issueNumber = parseInt(process.env.ISSUE_NUMBER, 10);
  const eventType = process.env.EVENT_TYPE;

  if (!issueNumber || !eventType) {
    console.error(
      "[notion-sync] Missing required env: ISSUE_NUMBER or EVENT_TYPE"
    );
    process.exit(1);
  }

  // label events — the core path
  if (eventType === "labeled" || eventType === "unlabeled") {
    const labelName = process.env.LABEL_NAME || "";
    await handleLabelEvent(issueNumber, eventType, labelName);
    return;
  }

  console.log(
    `[notion-sync] Unsupported event type "${eventType}" — no-op`
  );
}

main().catch((err) => {
  console.error("[notion-sync] Fatal error:", err.message);
  process.exit(1);
});
