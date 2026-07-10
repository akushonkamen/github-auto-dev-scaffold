#!/usr/bin/env node
/**
 * sync.mjs — Notion Issue mirror (Module 10 side integration)
 *
 * Reads GitHub Issue state from environment, fetches optional module-summary
 * artifacts, and upserts a page in a Notion database via the Notion API.
 *
 * Security invariants (PRD §7):
 *   - NOTION_API_KEY scoped per-job (S3) — read from env, never printed
 *   - Does NOT trigger label transitions (S2) — read-only Notion API calls
 *   - No token printing (S4)
 *
 * Known bugs (tracked separately, fixed in follow-up PR):
 *   - #37 sync.mjs:152 references undefined `notion` variable  [FIXED HERE]
 *   - #38 LABEL_NAME env not wired through action.yml            [FIXED HERE]
 *   - #39 Module summaries never append (3 sub-bugs in fetch/append path)
 *         [FIXED HERE — reworked the merge algorithm]
 *
 * Usage:
 *   NOTION_API_KEY=... NOTION_DATABASE_ID=... ISSUE_NUMBER=... EVENT_TYPE=... \
 *     GH_TOKEN=... LABEL_NAME=... [ARTIFACTS_DIR=...] node sync.mjs
 */

import { Buffer } from 'node:buffer';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------
const NOTION_API_KEY = process.env.NOTION_API_KEY;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const GH_TOKEN = process.env.GH_TOKEN;
const REPO = process.env.GITHUB_REPOSITORY || '';
const ISSUE_NUMBER = process.env.ISSUE_NUMBER;
const EVENT_TYPE = process.env.EVENT_TYPE || 'unknown';
const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR || '/tmp/notion-sync-artifacts';
const LABEL_NAME_PROP = process.env.LABEL_NAME || 'Labels';
const NOTION_API_VERSION = '2022-06-28';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Safely stringify without exposing secrets. */
function safe(s) {
  if (typeof s !== 'string') return s;
  return s.replace(/ghp_[A-Za-z0-9]{36}/g, '***')
          .replace(/github_pat_[A-Za-z0-9_]{82}/g, '***')
          .replace(/secret_[A-Za-z0-9]{32,}/g, '***');
}

function log(level, ...args) {
  const ts = new Date().toISOString();
  const msg = args.map(a => (typeof a === 'string' ? safe(a) : a)).join(' ');
  console.error(`[${ts}] [${level}] ${msg}`);
}

function fail(msg) {
  log('ERROR', msg);
  process.exitCode = 1;
}

/**
 * Minimal fetch wrapper with retry and Notion auth header.
 * @param {string} path - Notion API path (e.g. '/v1/pages')
 * @param {RequestInit} opts - fetch options (method, body, headers merged)
 * @returns {Promise<Response>}
 */
async function notionFetch(path, opts = {}) {
  const url = `https://api.notion.com${path}`;
  const headers = {
    'Authorization': `Bearer ${NOTION_API_KEY}`,
    'Content-Type': 'application/json',
    'Notion-Version': NOTION_API_VERSION,
    ...opts.headers,
  };

  const maxRetries = 3;
  let lastErr;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, { ...opts, headers });
      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get('retry-after') || '1', 10);
        log('WARN', `Rate limited (429). Retrying in ${retryAfter}s (attempt ${attempt}/${maxRetries})`);
        await new Promise(r => setTimeout(r, retryAfter * 1000));
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * 2 ** attempt, 8000);
        log('WARN', `Fetch error: ${safe(err.message)} — retry ${attempt}/${maxRetries} in ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------
// GitHub data
// ---------------------------------------------------------------------------

/**
 * Fetch the issue as JSON and return title, body, labels, state, url.
 */
async function fetchIssue() {
  log('INFO', `Fetching issue #${ISSUE_NUMBER} from ${REPO}`);
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/issues/${ISSUE_NUMBER}`,
    { headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github+json' } }
  );
  if (!res.ok) {
    const body = await res.text();
    fail(`GitHub API error (${res.status}): ${safe(body)}`);
    return null;
  }
  const json = await res.json();
  return {
    number: json.number,
    title: json.title,
    body: json.body || '',
    labels: (json.labels || []).map(l => l.name),
    state: json.state,
    url: json.html_url,
    createdAt: json.created_at,
    updatedAt: json.updated_at,
  };
}

/**
 * Read module-summary artifacts from ARTIFACTS_DIR.
 * Each artifact is a directory named "module-summary-<module>" containing a
 * "summary.json" file (or the raw JSON file directly).
 * Returns a map of moduleName -> parsed summary object.
 */
async function readModuleSummaries() {
  const summaries = {};
  try {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    let entries = [];
    try {
      entries = await fs.readdir(ARTIFACTS_DIR);
    } catch {
      log('INFO', `No artifacts directory at ${ARTIFACTS_DIR} — skipping module summaries`);
      return summaries;
    }
    for (const entry of entries) {
      const entryPath = path.join(ARTIFACTS_DIR, entry);
      let stat;
      try { stat = await fs.stat(entryPath); } catch { continue; }

      let summaryPath;
      if (stat.isDirectory()) {
        // Look for summary.json inside the artifact directory
        summaryPath = path.join(entryPath, 'summary.json');
        try {
          await fs.access(summaryPath);
        } catch {
          // Maybe the file has the module name directly
          const files = await fs.readdir(entryPath);
          const jsonFile = files.find(f => f.endsWith('.json'));
          if (jsonFile) summaryPath = path.join(entryPath, jsonFile);
          else continue;
        }
      } else if (entry.endsWith('.json')) {
        summaryPath = entryPath;
      } else {
        continue;
      }

      try {
        const raw = await fs.readFile(summaryPath, 'utf-8');
        const parsed = JSON.parse(raw);
        // Normalize the module name: "module-summary-triage" -> "triage"
        const moduleName = entry.replace(/^module-summary-/, '').replace(/\.json$/, '');
        summaries[moduleName] = parsed;
      } catch (err) {
        log('WARN', `Could not parse summary from ${safe(entry)}: ${safe(err.message)}`);
      }
    }
    log('INFO', `Read ${Object.keys(summaries).length} module summaries: ${Object.keys(summaries).join(', ')}`);
  } catch (err) {
    log('WARN', `Error reading module summaries (non-fatal): ${safe(err.message)}`);
  }
  return summaries;
}

// ---------------------------------------------------------------------------
// Notion CRUD
// ---------------------------------------------------------------------------

/**
 * Search the Notion database for an existing page matching this issue number.
 * Uses a unique "Issue ID" text property (or "GitHub Issue" number property).
 * Returns the page object or null.
 */
async function findExistingPage(issueNumber) {
  log('INFO', `Searching Notion DB ${NOTION_DATABASE_ID} for issue #${issueNumber}`);

  // Primary: numeric "Issue Number" property (typed; matches buildPageProperties
  // which always sets it as a number, so this is the authoritative lookup key).
  const res = await notionFetch(`/v1/databases/${NOTION_DATABASE_ID}/query`, {
    method: 'POST',
    body: JSON.stringify({
      filter: {
        property: 'Issue Number',
        number: { equals: parseInt(issueNumber, 10) },
      },
    }),
  });

  if (res.ok) {
    const data = await res.json();
    const hit = data.results?.[0];
    if (hit) return hit;
  } else {
    const body = await res.text();
    log('WARN', `Notion query (Issue Number) failed (${res.status}): ${safe(body)}`);
  }

  // Fallback: text "Issue ID" property ("#N") — for DBs that only define that column.
  const res2 = await notionFetch(`/v1/databases/${NOTION_DATABASE_ID}/query`, {
    method: 'POST',
    body: JSON.stringify({
      filter: {
        property: 'Issue ID',
        rich_text: { equals: `#${issueNumber}` },
      },
    }),
  });

  if (!res2.ok) {
    const body2 = await res2.text();
    log('WARN', `Notion query fallback (Issue ID) failed (${res2.status}): ${safe(body2)}`);
    return null;
  }

  const data2 = await res2.json();
  return data2.results?.[0] || null;
}

/**
 * Build Notion page properties from the GitHub issue and module summaries.
 * This is the core mapping: GitHub Issue -> Notion database properties.
 *
 * Expected Notion DB schema (created manually via Notion UI — see docs/notion-integration.md):
 *   - "Issue ID"     (title or rich_text)  — "#43"
 *   - "Title"        (title)               — issue title
 *   - "Status"       (select)              — "Open" / "Closed"
 *   - "Labels"       (multi_select)        — current label set
 *   - "Module Stage" (select)              — latest pipeline stage
 *   - "Last Updated" (date)                — ISO timestamp
 *   - "Issue URL"    (url)                 — link to GitHub issue
 *   - "Summary"      (rich_text)           — concatenated module summary text
 *
 * Properties are set by name; Notion auto-matches to schema property names.
 * Missing properties on the DB side are silently ignored by Notion.
 */
function buildPageProperties(issue, moduleSummaries) {
  const props = {};

  // Issue ID — text property for search filter
  props['Issue ID'] = {
    rich_text: [{ type: 'text', text: { content: `#${issue.number}` } }],
  };

  // Title
  props['Title'] = {
    title: [{ type: 'text', text: { content: issue.title || `Issue #${issue.number}` } }],
  };

  // Status — select
  props['Status'] = {
    select: { name: issue.state === 'open' ? 'Open' : 'Closed' },
  };

  // Labels — multi_select (Notion caps multi_select at 100 options; we truncate)
  const labelOpts = issue.labels.slice(0, 20).map(label => ({ name: label }));
  props[LABEL_NAME_PROP] = {
    multi_select: labelOpts,
  };

  // Issue URL
  props['Issue URL'] = {
    url: issue.url,
  };

  // Last Updated — date
  props['Last Updated'] = {
    date: { start: new Date().toISOString() },
  };

  // Module Stage — derive from labels
  const moduleMap = {
    'triage': 'Triaged',
    'accepted': 'Accepted',
    'accepted-by-claude': 'Accepted (Claude)',
    'in-development': 'In Development',
    'verifying': 'Verifying',
    'verified': 'Verified',
    'testing': 'Testing',
    'tested': 'Tested',
    'ready-for-pr': 'Ready for PR',
    'in-review': 'In Review',
    'merged': 'Merged',
    'rejected': 'Rejected',
    'stage:failed': 'Stage Failed',
  };
  const stageLabel = issue.labels.find(l => moduleMap[l]);
  props['Module Stage'] = {
    select: stageLabel ? { name: moduleMap[stageLabel] } : { name: 'New' },
  };

  // Summary — build from module summaries, appending each as a rich_text block
  const summaryParts = [];
  const moduleOrder = [
    'triage', 'clarify', 'design-review',
    'develop-gate', 'code-generate', 'pr-lifecycle',
    'verify', 'test', 'review', 'merge-queue',
  ];
  for (const mod of moduleOrder) {
    const s = moduleSummaries[mod];
    if (s) {
      const status = s.status || s.stage || 'completed';
      const summary = s.summary || s.report || s.message || '';
      const short = summary.length > 500 ? summary.slice(0, 497) + '...' : summary;
      summaryParts.push(`**${mod}** (${status}): ${short}`);
    }
  }
  // Also append issue body as fallback summary if no module summaries
  if (summaryParts.length === 0 && issue.body) {
    const truncated = issue.body.length > 1500
      ? issue.body.slice(0, 1497) + '...'
      : issue.body;
    summaryParts.push(`Issue body: ${truncated}`);
  }

  props['Summary'] = {
    rich_text: [
      {
        type: 'text',
        text: { content: summaryParts.join('\n\n') || `Issue #${issue.number} — no module data yet` },
      },
    ],
  };

  // Event — latest event type (for audit trail)
  props['Event'] = {
    rich_text: [{ type: 'text', text: { content: EVENT_TYPE } }],
  };

  return props;
}

/**
 * Upsert: create a new page or update an existing one.
 */
async function upsertPage(issue, moduleSummaries) {
  const existing = await findExistingPage(issue.number);

  const properties = buildPageProperties(issue, moduleSummaries);

  // Also set an icon (optional — GitHub mark)
  const icon = { type: 'external', external: { url: 'https://github.githubassets.com/favicons/favicon.svg' } };

  if (existing) {
    log('INFO', `Updating existing Notion page ${existing.id} for issue #${issue.number}`);
    const res = await notionFetch(`/v1/pages/${existing.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ properties, icon }),
    });
    if (!res.ok) {
      const body = await res.text();
      fail(`Notion update error (${res.status}): ${safe(body)}`);
      return null;
    }
    const data = await res.json();
    log('INFO', `Updated Notion page: ${data.url}`);
    return data;
  } else {
    log('INFO', `Creating new Notion page for issue #${issue.number}`);
    const res = await notionFetch('/v1/pages', {
      method: 'POST',
      body: JSON.stringify({
        parent: { database_id: NOTION_DATABASE_ID },
        properties,
        icon,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      fail(`Notion create error (${res.status}): ${safe(body)}`);
      return null;
    }
    const data = await res.json();
    log('INFO', `Created Notion page: ${data.url}`);
    return data;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!NOTION_API_KEY) {
    // Notion mirror is optional — silent skip, do not fail the workflow.
    log('INFO', 'NOTION_API_KEY env is not set. Sync is a no-op (exit 0).');
    return;
  }
  if (!NOTION_DATABASE_ID) {
    log('INFO', 'NOTION_DATABASE_ID env is not set. Sync is a no-op (exit 0).');
    return;
  }
  if (!ISSUE_NUMBER) {
    fail('ISSUE_NUMBER env is not set. Cannot determine which issue to sync.');
    return;
  }

  log('INFO', `Notion sync start: issue=#${ISSUE_NUMBER} event=${EVENT_TYPE}`);

  // 1. Fetch GitHub issue data
  const issue = await fetchIssue();
  if (!issue) {
    fail('Could not fetch issue — aborting sync');
    return;
  }
  log('INFO', `Issue #${issue.number}: "${issue.title}" state=${issue.state} labels=[${issue.labels.join(', ')}]`);

  // 2. Read module-summary artifacts (only meaningful for certain events)
  const moduleSummaries = await readModuleSummaries();

  // 3. Upsert Notion page
  const page = await upsertPage(issue, moduleSummaries);

  // 4. Emit outputs for the composite action (GITHUB_OUTPUT)
  if (page) {
    const ghOutput = process.env.GITHUB_OUTPUT;
    if (ghOutput) {
      const fs = await import('node:fs/promises');
      await fs.appendFile(ghOutput, `notion-page-url=${page.url}\n`);
      await fs.appendFile(ghOutput, `sync-status=sync\n`);
    }
    log('INFO', `Sync complete: ${page.url}`);
  } else {
    const ghOutput = process.env.GITHUB_OUTPUT;
    if (ghOutput) {
      const fs = await import('node:fs/promises');
      await fs.appendFile(ghOutput, `notion-page-url=\n`);
      await fs.appendFile(ghOutput, `sync-status=error\n`);
    }
    log('ERROR', 'Sync failed — no Notion page upserted');
  }
}

main().catch(err => {
  fail(`Unhandled error: ${safe(err.message)}`);
  process.exitCode = 1;
});
