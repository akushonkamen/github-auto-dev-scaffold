#!/usr/bin/env node

/**
 * Notion sync — module summary append (sync.mjs)
 *
 * Handles `module_summary` and `module_summary_push_fallback` events:
 * reads the module-summary artifact JSON, locates the Notion page for the
 * corresponding GitHub issue, and appends a module summary block
 * (H3 + code block + divider) to the page.
 *
 * Sub-bug fixes applied:
 *   1. issueNumber resolved from workflow run head_branch when not provided
 *      (was undefined → rejected by Notion API).
 *   2. Artifact lookup uses prefix match `module-summary-*` instead of
 *      exact match (artifact names include module + run_id suffix).
 *   3. Artifact JSON is read directly from a pre-downloaded + unzipped file
 *      (was base64-encoded zip bytes → wall of garbage in Notion).
 *
 * Requires Node 20+ (native fetch). No npm dependencies.
 */

import { readFileSync } from 'node:fs';

// ── Environment inputs ──────────────────────────────────────────────────────
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DB_ID  = process.env.NOTION_DB_ID;
const EVENT_TYPE    = process.env.EVENT_TYPE;
let   issueNumber   = process.env.ISSUE_NUMBER || '';
const SOURCE_RUN_ID = process.env.SOURCE_RUN_ID || '';
const REPO          = process.env.REPO || '';
const GH_TOKEN      = process.env.GH_TOKEN || '';
const ARTIFACT_JSON_PATH = process.env.ARTIFACT_JSON_PATH || '';
const HEAD_BRANCH   = process.env.WORKFLOW_RUN_HEAD_BRANCH || '';

const NOTION_API = 'https://api.notion.com/v1';
const GITHUB_API = process.env.GITHUB_API_URL || 'https://api.github.com';
const NOTION_VERSION = '2022-06-28';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal logger that doesn't leak secrets (PRD §7 S4). */
function log(msg) {
  process.stderr.write(`[notion-sync] ${msg}\n`);
}

/**
 * Extract an issue number from a branch name like `claude/issue-39-slug`.
 * Returns the numeric string or null.
 */
function extractIssueFromBranch(branch) {
  if (!branch) return null;
  const m = branch.match(/claude\/issue-(\d+)/);
  return m ? m[1] : null;
}

/**
 * Fetch the workflow-run object from GitHub and extract issue number from
 * `head_branch`.  Sub-bug 1 fallback.
 */
async function extractIssueNumberFromRun(runId, repo, token) {
  const url = `${GITHUB_API}/repos/${repo}/actions/runs/${runId}`;
  log(`Fetching workflow run ${runId} to resolve issue number…`);
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) {
    log(`GitHub API error ${res.status} fetching run ${runId}`);
    return null;
  }
  const run = await res.json();
  return extractIssueFromBranch(run.head_branch);
}

// ── Notion API helpers ──────────────────────────────────────────────────────

const notionHeaders = {
  Authorization: `Bearer ${NOTION_TOKEN}`,
  'Content-Type': 'application/json',
  'Notion-Version': NOTION_VERSION,
};

/**
 * Query the Notion database for the page whose `IssueNumber` property matches
 * the given number.  Returns the page ID string, or throws.
 */
async function findNotionPage(issueNum) {
  log(`Querying Notion DB for issue #${issueNum}…`);
  const res = await fetch(`${NOTION_API}/databases/${NOTION_DB_ID}/query`, {
    method: 'POST',
    headers: notionHeaders,
    body: JSON.stringify({
      filter: {
        property: 'IssueNumber',
        number: { equals: parseInt(issueNum, 10) },
      },
      page_size: 1,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Notion query failed (${res.status}): ${body}`);
  }
  const data = await res.json();
  if (!data.results || data.results.length === 0) {
    throw new Error(`No Notion page found for issue #${issueNum}`);
  }
  return data.results[0].id;
}

/**
 * Append children blocks to a Notion page.
 * Blocks: H3 (module name), code block (summary), divider.
 */
async function appendNotionBlocks(pageId, blocks) {
  const res = await fetch(`${NOTION_API}/blocks/${pageId}/children`, {
    method: 'PATCH',
    headers: notionHeaders,
    body: JSON.stringify({ children: blocks }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Notion append failed (${res.status}): ${body}`);
  }
  return res.json();
}

// ── Module-summary append ───────────────────────────────────────────────────

/**
 * Build Notion block array for a module summary entry:
 *   - H3 heading:  module name
 *   - Code block:  summary text + idempotency key + run_id
 *   - Divider
 */
function buildModuleSummaryBlocks(moduleName, summary, runId, idempotencyKey) {
  const codeContent =
    `idempotency_key: ${idempotencyKey || 'N/A'}\n` +
    `run_id: ${runId || 'N/A'}\n` +
    `summary: ${summary || '(empty)'}`;

  return [
    {
      object: 'block',
      type: 'heading_3',
      heading_3: {
        rich_text: [{ type: 'text', text: { content: moduleName || 'Unknown module' } }],
      },
    },
    {
      object: 'block',
      type: 'code',
      code: {
        rich_text: [{ type: 'text', text: { content: codeContent } }],
        language: 'plain text',
      },
    },
    {
      object: 'block',
      type: 'divider',
      divider: {},
    },
  ];
}

/**
 * Read the module-summary artifact JSON, locate the Notion page, and append.
 */
async function appendModuleSummary() {
  // ── 1. Read artifact JSON (sub-bug 3: already unzipped, not base64) ──
  if (!ARTIFACT_JSON_PATH) {
    throw new Error('ARTIFACT_JSON_PATH not set');
  }
  let artifact;
  try {
    artifact = JSON.parse(readFileSync(ARTIFACT_JSON_PATH, 'utf-8'));
  } catch (err) {
    throw new Error(`Failed to read/parse artifact JSON at ${ARTIFACT_JSON_PATH}: ${err.message}`);
  }

  const moduleName      = artifact.module || 'unknown';
  const summary         = artifact.summary || '';
  const runId           = artifact.run_id || SOURCE_RUN_ID;
  const idempotencyKey  = artifact.idempotency_key || `${moduleName}-${runId}`;

  // ── 2. Resolve issue number (sub-bug 1 fix) ──────────────────────────
  if (!issueNumber) {
    // Priority 1: from workflow-run head_branch env var
    issueNumber = extractIssueFromBranch(HEAD_BRANCH) || '';

    // Priority 2: fetch the run object from GitHub API
    if (!issueNumber && SOURCE_RUN_ID && REPO && GH_TOKEN) {
      issueNumber = (await extractIssueNumberFromRun(SOURCE_RUN_ID, REPO, GH_TOKEN)) || '';
    }

    // Priority 3: from the artifact JSON itself
    if (!issueNumber && artifact.issue_number) {
      issueNumber = String(artifact.issue_number);
    }
  }

  if (!issueNumber) {
    throw new Error(
      'Cannot resolve issue number: ISSUE_NUMBER is empty, head_branch has no claude/issue-N pattern, ' +
      'and artifact JSON has no issue_number field. Sub-bug 1 condition.'
    );
  }

  log(`Resolved issue number: #${issueNumber}  module: ${moduleName}`);

  // ── 3. Find Notion page ──────────────────────────────────────────────
  const pageId = await findNotionPage(issueNumber);

  // ── 4. Build + append blocks ─────────────────────────────────────────
  const blocks = buildModuleSummaryBlocks(moduleName, summary, runId, idempotencyKey);
  await appendNotionBlocks(pageId, blocks);

  log(`Appended ${moduleName} summary to Notion page for issue #${issueNumber}`);
}

// ── Push-fallback handler ───────────────────────────────────────────────────
// When a workflow_run trigger isn't available (e.g. push events), we can still
// append a module summary from the artifact downloaded by the caller.

async function appendModuleSummaryPushFallback() {
  log('Push-fallback mode: reading artifact and appending…');
  // Same flow as module_summary — the action has already downloaded the artifact.
  await appendModuleSummary();
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!NOTION_TOKEN) {
    log('NOTION_TOKEN not set — skipping Notion sync');
    process.exit(0);
  }
  if (!NOTION_DB_ID) {
    log('NOTION_DB_ID not set — skipping Notion sync');
    process.exit(0);
  }

  switch (EVENT_TYPE) {
    case 'module_summary':
      await appendModuleSummary();
      break;
    case 'module_summary_push_fallback':
      await appendModuleSummaryPushFallback();
      break;
    default:
      log(`Unknown EVENT_TYPE: ${EVENT_TYPE} — nothing to do`);
      process.exit(0);
  }
}

// Only auto-run when invoked directly (not when imported by tests).
const _mainPath = import.meta.url.replace(/^file:\/\//, '');
if (process.argv[1] === _mainPath) {
  main().catch((err) => {
    log(`FATAL: ${err.message}`);
    process.exit(1);
  });
}

export { extractIssueFromBranch, buildModuleSummaryBlocks };
