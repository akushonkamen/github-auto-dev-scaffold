#!/usr/bin/env node

import { Client } from '@notionhq/client';

// Pure helpers exported for testing
export function labelIdempotencyKey(issueNumber, action, labelName, eventId) {
  return `${issueNumber}-${action}-${labelName}-${eventId}`;
}

export function moduleIdempotencyKey(issueNumber, moduleName, runId) {
  return `${issueNumber}-${moduleName}-${runId}`;
}

// Compute the highest-priority Status from a list of labels per the priority chain.
// Returns undefined when no known status label is present.
const STATUS_PRIORITY = [
  'merged', 'in-review', 'ready-for-pr', 'testing',
  'verified', 'in-development', 'accepted', 'triage',
];

export function computeStatusLabel(labels) {
  const set = new Set(labels || []);
  for (const label of STATUS_PRIORITY) {
    if (set.has(label)) return label;
  }
  return undefined;
}

export function applyLabelDelta(currentLabels, action, labelName) {
  const list = [...(currentLabels || [])];
  if (action === 'labeled') {
    if (!list.includes(labelName)) list.push(labelName);
  } else if (action === 'unlabeled') {
    const idx = list.indexOf(labelName);
    if (idx > -1) list.splice(idx, 1);
  }
  return list;
}

// Check whether an idempotency key is already present in a list of Notion blocks.
export function isIdempotencyKeyPresent(blocks, idempotencyKey) {
  return (blocks || []).some(block =>
    block.type === 'code' &&
    block.code?.rich_text?.[0]?.text?.content?.includes(idempotencyKey)
  );
}

// Build the Notion page properties payload for a new issue mirror.
export function buildIssuePageProperties(issueNumber, repo) {
  const url = `https://github.com/${repo}/issues/${issueNumber}`;
  return {
    properties: {
      Title: { title: [{ text: { content: `Issue #${issueNumber}` } }] },
      'GitHub Issue URL': { url },
      Status: { select: { name: 'New' } },
    },
  };
}

// Build the Notion blocks payload for a module-summary append.
export function buildModuleSummaryBlocks(moduleName, idempotencyKey, summary) {
  return [
    {
      object: 'block',
      type: 'heading_3',
      heading_3: {
        rich_text: [{ type: 'text', text: { content: `${moduleName} Summary` } }],
      },
    },
    {
      object: 'block',
      type: 'code',
      code: {
        rich_text: [{ type: 'text', text: { content: `${idempotencyKey}\n\n${summary}` } }],
        language: 'text',
      },
    },
    { object: 'block', type: 'divider', divider: {} },
  ];
}

// Build a Notion filter for looking up a page by GitHub issue URL.
export function buildIssueUrlFilter(repo, issueNumber) {
  return {
    property: 'GitHub Issue URL',
    url: `https://github.com/${repo}/issues/${issueNumber}`,
  };
}


// Token bucket for Notion 3 req/s rate limit
class TokenBucket {
  constructor(rate, interval) {
    this.tokens = rate;
    this.rate = rate;
    this.interval = interval;
    this.lastRefill = Date.now();
  }

  async wait() {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.tokens += elapsed * (this.rate / this.interval);
    if (this.tokens > this.rate) this.tokens = this.rate;
    this.lastRefill = now;

    if (this.tokens < 1) {
      const waitTime = (1 - this.tokens) * (this.interval / this.rate);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      this.tokens = 0;
    } else {
      this.tokens -= 1;
    }
  }
}

const bucket = new TokenBucket(3, 1000);

// Audit comment helpers
async function postAuditComment(message) {
  const issueNumber = process.env.ISSUE_NUMBER;
  if (!issueNumber) return;

  try {
    const response = await fetch(
      `${process.env.GITHUB_API_URL}/repos/${process.env.GITHUB_REPOSITORY}/issues/${issueNumber}/comments`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.GH_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ body: message }),
      }
    );
    if (!response.ok) {
      console.error(`Failed to post audit comment: ${response.statusText}`);
    }
  } catch (error) {
    console.error(`Error posting audit comment: ${error.message}`);
  }
}

async function postErrorAuditComment(error) {
  await postAuditComment(`notion sync failed: ${error.message}`);
}

// Notion API helpers with rate limiting
async function createPageInDatabase(databaseId, pageData) {
  await bucket.wait();
  return notion.pages.create({ parent: { database_id: databaseId }, ...pageData });
}

async function updatePage(pageId, pageData) {
  await bucket.wait();
  return notion.pages.update({ page_id: pageId, ...pageData });
}

async function queryDatabase(databaseId, filter) {
  await bucket.wait();
  return getNotion().databases.query({ database_id: databaseId, filter });
}

// Initialize Notion client (deferred so the module is importable for tests
// when NOTION_API_KEY / NOTION_DATABASE_ID are not present).
function getNotion() {
  return new Client({ auth: process.env.NOTION_API_KEY });
}

function getDatabaseId() {
  return process.env.NOTION_DATABASE_ID;
}

// Find or create Notion page for issue
async function getOrCreatePageForIssue(issueNumber) {
  const databaseId = getDatabaseId();
  const filter = buildIssueUrlFilter(process.env.GITHUB_REPOSITORY, issueNumber);

  const response = await queryDatabase(databaseId, filter);
  if (response.results.length > 0) {
    return response.results[0];
  }

  // Create new page
  try {
    const page = await createPageInDatabase(databaseId, buildIssuePageProperties(issueNumber, process.env.GITHUB_REPOSITORY));

    // Post audit comment with Notion URL
    await postAuditComment(`Notion mirror: ${page.url}`);

    return page;
  } catch (error) {
    await postErrorAuditComment(error);
    throw error;
  }
}

// Update page properties for label events
async function handleLabelEvent(issueNumber, action, labelName) {
  try {
    const page = await getOrCreatePageForIssue(issueNumber);

    const updates = {
      properties: {
        'Last Synced At': {
          last_edited_time: new Date().toISOString(),
        },
      },
    };

    const existingLabels = page.properties.Labels?.multi_select?.map(l => l.name) || [];
    const currentLabels = applyLabelDelta(existingLabels, action, labelName);

    const statusLabel = computeStatusLabel(currentLabels);
    if (statusLabel) {
      updates.properties.Status = { select: { name: statusLabel } };
    }

    updates.properties.Labels = {
      multi_select: currentLabels.map(name => ({ name })),
    };

    await updatePage(page.id, updates);
  } catch (error) {
    await postErrorAuditComment(error);
    // Exit gracefully per plan requirements
    process.exit(0);
  }
}

// Fetch module summary from GitHub
async function fetchModuleSummary(runId) {
  try {
    const response = await fetch(
      `${process.env.GITHUB_API_URL}/repos/${process.env.GITHUB_REPOSITORY}/actions/runs/${runId}/artifacts`,
      {
        headers: {
          'Authorization': `Bearer ${process.env.GH_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch artifacts: ${response.statusText}`);
    }

    const data = await response.json();
    const summaryArtifact = data.artifacts.find(a => a.name === 'module-summary');
    if (!summaryArtifact) {
      throw new Error('module-summary artifact not found');
    }

    // Download artifact
    const downloadResponse = await fetch(summaryArtifact.archive_download_url, {
      headers: {
        'Authorization': `Bearer ${process.env.GH_TOKEN}`,
      },
    });

    if (!downloadResponse.ok) {
      throw new Error(`Failed to download artifact: ${downloadResponse.statusText}`);
    }

    const buffer = await downloadResponse.arrayBuffer();
    // For now, return a placeholder. In a full implementation, unzip and parse the artifact
    return {
      module_name: summaryArtifact.workflow_run?.name || 'unknown',
      summary: Buffer.from(buffer).toString('base64'),
    };
  } catch (error) {
    await postErrorAuditComment(error);
    throw error;
  }
}

// Append module summary to page body
async function appendModuleSummary(issueNumber, moduleName, summary, runId) {
  try {
    const page = await getOrCreatePageForIssue(issueNumber);

    const idempotencyKey = moduleIdempotencyKey(issueNumber, moduleName, runId);
    const notionClient = getNotion();
    const existingBlocks = await notionClient.blocks.children.list({ block_id: page.id, page_size: 100 });

    if (isIdempotencyKeyPresent(existingBlocks.results, idempotencyKey)) {
      console.log(`Module summary ${idempotencyKey} already appended, skipping`);
      return;
    }

    await notionClient.blocks.children.append({
      block_id: page.id,
      children: buildModuleSummaryBlocks(moduleName, idempotencyKey, summary),
    });

    // Update Last Synced At
    await updatePage(page.id, {
      properties: {
        'Last Synced At': {
          last_edited_time: new Date().toISOString(),
        },
      },
    });
  } catch (error) {
    await postErrorAuditComment(error);
    // Exit gracefully
    process.exit(0);
  }
}

// Main event handler
async function main() {
  const eventType = process.env.EVENT_TYPE;
  const issueNumber = process.env.ISSUE_NUMBER;
  const sourceRunId = process.env.SOURCE_RUN_ID;
  const branch = process.env.BRANCH;
  const commitSha = process.env.COMMIT_SHA;

  if (!getDatabaseId()) {
    console.error('NOTION_DATABASE_ID environment variable is required');
    process.exit(1);
  }

  try {
    if (eventType === 'opened') {
      await getOrCreatePageForIssue(issueNumber);
    } else if (eventType === 'labeled' || eventType === 'unlabeled') {
      const labelName = process.env.LABEL_NAME || '';
      await handleLabelEvent(issueNumber, eventType, labelName);
    } else if (eventType === 'module_summary') {
      const summary = await fetchModuleSummary(sourceRunId);
      await appendModuleSummary(issueNumber, summary.module_name, summary.summary, sourceRunId);
    } else if (eventType === 'module_summary_push_fallback') {
      // For push fallback, extract issue number from branch name (claude/issue-N)
      const match = branch?.match(/claude\/issue-(\d+)/);
      if (!match) {
        console.error(`Cannot extract issue number from branch: ${branch}`);
        process.exit(0);
      }
      const fallbackIssueNumber = match[1];
      // Fetch summary from commit or GitHub API - placeholder implementation
      await appendModuleSummary(fallbackIssueNumber, 'push-fallback', `Commit: ${commitSha}`, commitSha);
    } else {
      console.error(`Unknown event type: ${eventType}`);
      process.exit(1);
    }
  } catch (error) {
    await postErrorAuditComment(error);
    // Exit gracefully per plan requirements
    process.exit(0);
  }
}

// Only run main() when invoked directly, not when imported by tests.
const isMainModule = process.argv[1] && (
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url === `file://${process.argv[1].replace(/\/$/, '')}`
);

if (isMainModule) {
  main().catch(async (error) => {
    console.error(error);
    await postErrorAuditComment(error);
    process.exit(0);
  });
}
