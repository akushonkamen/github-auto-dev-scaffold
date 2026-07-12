#!/usr/bin/env node
/**
 * sync.mjs — Feishu (Lark) Issue mirror + event notification
 *
 * PR-1 skeleton: safe() extension (Feishu token formats) + log() + fail() +
 * silent-skip mode (FEISHU_APP_ID missing → exit 0). Real Feishu API calls
 * land in PR-2 (notify) and PR-3 (Bitable mirror).
 *
 * Security invariants (CLAUDE.md S1-S7):
 *   - All Feishu secrets scoped per-job via action.yml env: injection (S3)
 *   - safe() redacts Feishu + GitHub token formats from all log output (S4)
 *   - Silent skip when FEISHU_APP_ID missing — does not fail the pipeline
 *     (aligned with notion-sync sync.mjs:410-418)
 *
 * Unlike notion-sync/sync.mjs (which exports nothing), this module exports
 * every pure function so unit tests do not need to mirror-write the logic
 * (anti-example evidence: notion-sync/sync.mjs has 0 export statements).
 *
 * Usage:
 *   FEISHU_APP_ID=... FEISHU_APP_SECRET=... ISSUE_NUMBER=... EVENT_TYPE=... \
 *     node sync.mjs
 */

import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Token format constants (used by safe() — keep in sync with test/safe.test.mjs)
// ---------------------------------------------------------------------------

// GitHub token formats
const GH_PAT_CLASSIC = /ghp_[A-Za-z0-9]{36}/g;          // classic PAT
const GH_PAT_FINE = /github_pat_[A-Za-z0-9_]{82}/g;       // fine-grained PAT
const GH_OAUTH = /gho_[A-Za-z0-9]{36}/g;                  // OAuth token
const GH_USER = /ghu_[A-Za-z0-9]{36}/g;                   // user-to-server
const GH_REFRESH = /ghr_[A-Za-z0-9]{76}/g;                // refresh token

// Feishu / Lark token formats
// t-xxx        : user access token (Feishu)
// t-gxxx       : tenant access token (Feishu)
// t-clxxx      : client token
// cli_xxx      : app-level / cli-style token (Lark suite variant)
const FEISHU_USER_TOKEN = /\bt-[A-Za-z0-9]{20,}\b/g;
const FEISHU_TENANT_TOKEN = /\bt-g[A-Za-z0-9]{20,}\b/g;
const FEISHU_CLIENT_TOKEN = /\bt-cl[A-Za-z0-9]{20,}\b/g;
const FEISHU_CLI_TOKEN = /\bcli_[A-Za-z0-9]{20,}\b/g;

// Feishu App Secret — 32 hex chars (lower or upper)
const FEISHU_APP_SECRET_PATTERN = /\b[0-9a-fA-F]{32}\b/g;

// Generic secret_<value> format (inherited from notion-sync safe)
const GENERIC_SECRET = /secret_[A-Za-z0-9]{32,}/g;

const REDACTION_PATTERNS = [
  GH_PAT_CLASSIC,
  GH_PAT_FINE,
  GH_OAUTH,
  GH_USER,
  GH_REFRESH,
  FEISHU_USER_TOKEN,
  FEISHU_TENANT_TOKEN,
  FEISHU_CLIENT_TOKEN,
  FEISHU_CLI_TOKEN,
  GENERIC_SECRET,
];

// App secret is intentionally LAST — 32 hex is short and could substring-match
// inside a longer token. Run it after the more specific patterns have replaced
// their targets with '***'.
const REDACTION_PATTERNS_WITH_APPSECRET = [...REDACTION_PATTERNS, FEISHU_APP_SECRET_PATTERN];

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------
const FEISHU_APP_ID = process.env.FEISHU_APP_ID;
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET;
const FEISHU_VERIFICATION_TOKEN = process.env.FEISHU_VERIFICATION_TOKEN;
const FEISHU_CHAT_ID = process.env.FEISHU_CHAT_ID;
const FEISHU_BITABLE_APP_TOKEN = process.env.FEISHU_BITABLE_APP_TOKEN;
const FEISHU_BITABLE_TABLE_ID = process.env.FEISHU_BITABLE_TABLE_ID;
const ISSUE_NUMBER = process.env.ISSUE_NUMBER;
const EVENT_TYPE = process.env.EVENT_TYPE || 'unknown';

// ---------------------------------------------------------------------------
// Helpers (all exported for unit testing)
// ---------------------------------------------------------------------------

/**
 * Safely stringify without exposing secrets. Redacts:
 *   - GitHub PAT (classic / fine / OAuth / user / refresh)
 *   - Feishu access tokens (user / tenant / client / cli_)
 *   - Feishu App Secret (32 hex)
 *   - generic secret_<32+ chars>
 *
 * Non-string inputs are returned unchanged.
 *
 * @param {string|*} s
 * @returns {string|*}
 */
export function safe(s) {
  if (typeof s !== 'string') return s;
  let out = s;
  for (const pat of REDACTION_PATTERNS_WITH_APPSECRET) {
    out = out.replace(pat, '***');
  }
  return out;
}

/**
 * Structured log line — ISO timestamp + level + safe(message).
 * Writes to stderr to avoid polluting stdout used by GITHUB_OUTPUT.
 *
 * @param {'INFO'|'WARN'|'ERROR'} level
 * @param {...*} args
 */
export function log(level, ...args) {
  const ts = new Date().toISOString();
  const msg = args.map((a) => (typeof a === 'string' ? safe(a) : a)).join(' ');
  console.error(`[${ts}] [${level}] ${msg}`);
}

/**
 * Set exitCode=1 (does not throw — aligned with notion-sync sync.mjs:57-60
 * so caller can finish cleanup before process exits).
 *
 * @param {string} msg
 */
export function fail(msg) {
  log('ERROR', msg);
  process.exitCode = 1;
}

/**
 * Detect whether all required Feishu inputs are present. Used by main() to
 * decide silent-skip vs proceed. Exposed for unit testing.
 *
 * Reads process.env at call time so tests can mutate env per-case.
 *
 * @returns {boolean}
 */
export function hasRequiredFeishuInputs() {
  return Boolean(process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET);
}

// ---------------------------------------------------------------------------
// Feishu API client (PR-2)
// ---------------------------------------------------------------------------
//
// Token lifecycle: tenant_access_token expires every 2h. We cache with a
// 10-minute safety margin (expire=now+1h50m) and retry once on 401.
// Refetch on 401 is mandatory — token can be invalidated server-side early.

const FEISHU_BASE = 'https://open.feishu.cn';
const TOKEN_REFRESH_MARGIN_MS = 10 * 60 * 1000; // refresh 10 min before real expiry

/** @typedef {{token: string, expiresAt: number}} TokenCache */
let _tokenCache = null; // module-level cache for single-run use

/**
 * Fetch a fresh tenant_access_token from Feishu.
 *
 * @param {{appId: string, appSecret: string, fetcher?: typeof fetch}} opts
 * @returns {Promise<{token: string, expiresInSec: number}>}
 * @throws on non-200 / network error
 */
export async function fetchTenantAccessToken({ appId, appSecret, fetcher = fetch }) {
  if (!appId || !appSecret) {
    throw new Error('fetchTenantAccessToken: appId and appSecret are required');
  }
  const url = `${FEISHU_BASE}/open-apis/auth/v3/tenant_access_token/internal`;
  const res = await fetcher(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const json = await res.json();
  if (json.code !== 0 || !json.tenant_access_token) {
    const err = new Error(`tenant_access_token fetch failed: code=${json.code} msg=${json.msg || 'n/a'}`);
    err.payload = json;
    throw err;
  }
  return { token: json.tenant_access_token, expiresInSec: json.expire };
}

/**
 * Get a cached tenant_access_token (or refetch if missing / near-expiry).
 * First call hits Feishu; subsequent calls within the same process return
 * cached token until it expires.
 *
 * @param {{appId: string, appSecret: string, fetcher?: typeof fetch, now?: () => number}} opts
 * @returns {Promise<string>}
 */
export async function getTenantAccessToken({ appId, appSecret, fetcher = fetch, now = Date.now }) {
  if (_tokenCache && _tokenCache.expiresAt > now() + TOKEN_REFRESH_MARGIN_MS) {
    return _tokenCache.token;
  }
  const { token, expiresInSec } = await fetchTenantAccessToken({ appId, appSecret, fetcher });
  _tokenCache = { token, expiresAt: now() + expiresInSec * 1000 };
  return token;
}

/** Test-only: reset token cache between unit tests. */
export function _resetTokenCacheForTest() {
  _tokenCache = null;
}

/**
 * Feishu OpenAPI wrapper with 401 auto-retry. On 401, refetches the
 * tenant_access_token (once) and retries the original request.
 *
 * @param {string} path
 * @param {{method?: string, body?: object, params?: Record<string,string>, appId: string, appSecret: string, fetcher?: typeof fetch}} opts
 * @returns {Promise<{ok: boolean, status: number, json: any}>}
 */
export async function feishuFetch(path, opts) {
  const { method = 'GET', body, params, appId, appSecret, fetcher = fetch } = opts;
  const query = params ? '?' + new URLSearchParams(params).toString() : '';
  const url = `${FEISHU_BASE}${path}${query}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getTenantAccessToken({ appId, appSecret, fetcher });
    const res = await fetcher(url, {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401 && attempt === 0) {
      log('WARN', 'feishuFetch got 401 — invalidating token cache and retrying once');
      _resetTokenCacheForTest();
      continue;
    }
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, json };
  }
  // Two 401s in a row — Feishu is rejecting our token. Surface as error.
  return { ok: false, status: 401, json: { code: 401, msg: 'unauthorized after retry' } };
}

/**
 * Post an interactive card to a Feishu chat.
 *
 * @param {{chatId: string, msgType?: 'interactive'|'text', content: object, appId: string, appSecret: string, fetcher?: typeof fetch}} opts
 * @returns {Promise<{ok: boolean, status: number, messageId?: string, error?: string}>}
 */
export async function postCard({ chatId, msgType = 'interactive', content, appId, appSecret, fetcher = fetch }) {
  if (!chatId) return { ok: false, status: 0, error: 'chatId required' };
  if (!content) return { ok: false, status: 0, error: 'content required' };

  const result = await feishuFetch('/open-apis/im/v1/messages', {
    method: 'POST',
    params: { receive_id_type: 'chat_id' },
    body: {
      receive_id: chatId,
      msg_type: msgType,
      content: typeof content === 'string' ? content : JSON.stringify(content),
    },
    appId, appSecret, fetcher,
  });

  if (!result.ok || result.json.code !== 0) {
    return {
      ok: false,
      status: result.status,
      error: `postCard failed: code=${result.json.code} msg=${result.json.msg || 'n/a'}`,
    };
  }
  return {
    ok: true,
    status: result.status,
    messageId: result.json?.data?.message_id,
  };
}

/**
 * Build an interactive card payload for review-completed events.
 *
 * Card schema v1 (PR-6): `msg_type=interactive`，含 Approve / Request Changes
 * 按钮，按钮 `value` 携带 {owner, repo, pr_number}。bridge 收到
 * `card.action.trigger` 后通过 actions/pr-review.mjs 路由。
 *
 * Owner/repo 来源：GITHUB_REPOSITORY env（GitHub Actions 默认注入
 * `owner/repo` 格式），允许 PR_REPOSITORY env 覆盖。
 *
 * @param {{prNumber: number|string, prTitle: string, prUrl: string, reviewer?: string, verdict?: 'approved'|'changes_requested'|'completed'}} ctx
 * @returns {{msg_type: 'interactive', content: string}}
 */
export function renderReviewCard({ prNumber, prTitle, prUrl, reviewer, verdict }) {
  const verdictEmoji = {
    approved: '✅',
    changes_requested: '🔁',
    completed: '✅',
  }[verdict] || '🔔';

  // owner/repo from env so the bridge can route card-action back to the right PR
  const repoSlug = process.env.PR_REPOSITORY || process.env.GITHUB_REPOSITORY || '';
  const [owner, repo] = repoSlug.split('/');
  const hasValidTarget = Boolean(owner && repo);

  // Button value — only set when owner/repo known; otherwise omitted so bridge
  // replies "missing PR target" rather than posting a malformed review.
  const btnValue = hasValidTarget
    ? { owner, repo, pr_number: Number(prNumber) }
    : {};

  const card = {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `${verdictEmoji} PR #${prNumber} ${verdict || 'review'}` },
      template: verdict === 'changes_requested' ? 'red' : 'green',
    },
    elements: [
      { tag: 'div', text: { tag: 'lark_md', content: `**${prTitle}**` } },
    ],
  };

  if (reviewer) {
    card.elements.push({ tag: 'div', text: { tag: 'lark_md', content: `Reviewer: ${reviewer}` } });
  }
  card.elements.push({ tag: 'div', text: { tag: 'lark_md', content: `[Open PR](${prUrl})` } });

  // Buttons — Approve (green) + Request Changes (red)
  // Notes:
  //   - `tag: 'button'` + `type: 'default' | 'primary' | 'danger'`
  //   - `value` is arbitrary JSON, bridge reads it on click
  //   - Bridge verifies CODEOWNERS again before posting the review (S7)
  card.elements.push({
    tag: 'action',
    actions: [
      {
        tag: 'button',
        text: { tag: 'plain_text', content: '✅ Approve' },
        type: 'primary',
        value: { ...btnValue, action: 'approve' },
      },
      {
        tag: 'button',
        text: { tag: 'plain_text', content: '🔁 Request Changes' },
        type: 'danger',
        value: { ...btnValue, action: 'request_changes' },
      },
    ],
  });

  return { msg_type: 'interactive', content: JSON.stringify({ card }) };
}

// ---------------------------------------------------------------------------
// Bitable mirror (PR-3)
// ---------------------------------------------------------------------------
//
// Mirrors GitHub Issue state to a Feishu Bitable table. Search-then-upsert
// keyed on "Issue Number" column. Assignees column stores sha256(open_id)[:12]
// for PII-safe deduplication (no raw Feishu user IDs in Bitable).
//
// Column schema (per docs/feishu-integration.md §Step 3):
//   Issue Number (Number) | Title (Text) | State (Single Select) |
//   Labels (Multi Select) | Assignees (Multi Select) | Updated At (DateTime)

/**
 * Shorten an open_id (or any identifier) for PII-safe storage.
 * Returns the first 12 hex chars of sha256(input). 12 chars = 48 bits =
 * collision probability < 1e-6 for up to 10k distinct inputs — good enough
 * for Issue mirror deduplication.
 *
 * @param {string} open_id
 * @returns {string} 12-char hex
 */
export function shortenOpenId(open_id) {
  return crypto.createHash('sha256').update(String(open_id)).digest('hex').slice(0, 12);
}

/**
 * Build a Bitable fields object from a GitHub Issue.
 *
 * @param {{number: number|string, title: string, state?: string, labels?: string[], assignees?: string[], updatedAt?: string|number}} issue
 * @returns {object} Bitable fields keyed by column name
 */
export function renderIssueRow({ number, title, state, labels, assignees, updatedAt }) {
  const ts = updatedAt
    ? (typeof updatedAt === 'number' ? updatedAt : new Date(updatedAt).getTime())
    : Date.now();
  return {
    'Issue Number': Number(number),
    'Title': String(title || ''),
    'State': state || 'triage',
    'Labels': (labels || []).map(String),
    'Assignees': (assignees || []).map(shortenOpenId),
    'Updated At': ts,
  };
}

/**
 * Search a Bitable table for a record by Issue Number.
 *
 * @param {{appId: string, appSecret: string, appToken: string, tableId: string, issueNumber: number|string, fetcher?: typeof fetch}} opts
 * @returns {Promise<{ok: boolean, recordId?: string, error?: string}>}
 */
export async function findBitableRecord({ appId, appSecret, appToken, tableId, issueNumber, fetcher = fetch }) {
  if (!appToken || !tableId) {
    return { ok: false, error: 'appToken and tableId required' };
  }
  const result = await feishuFetch(
    `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/search`,
    {
      method: 'POST',
      params: { page_size: '2' },
      body: {
        filter: {
          conjunction: 'and',
          conditions: [
            { field_name: 'Issue Number', operator: 'is', value: [String(issueNumber)] },
          ],
        },
      },
      appId, appSecret, fetcher,
    },
  );
  if (!result.ok || result.json.code !== 0) {
    return {
      ok: false,
      error: `search failed: code=${result.json.code} msg=${result.json.msg || 'n/a'}`,
    };
  }
  const items = result.json?.data?.items || [];
  if (items.length === 0) return { ok: true };
  return { ok: true, recordId: items[0].record_id };
}

/**
 * Upsert a record into Bitable: search by Issue Number, create if not found,
 * update if found. The Issue Number column is the deduplication key.
 *
 * @param {{appId: string, appSecret: string, appToken: string, tableId: string, fields: object, fetcher?: typeof fetch}} opts
 * @returns {Promise<{ok: boolean, action?: 'create'|'update', recordId?: string, error?: string}>}
 */
export async function bitableUpsert({ appId, appSecret, appToken, tableId, fields, fetcher = fetch }) {
  const issueNumber = fields['Issue Number'];
  if (!issueNumber && issueNumber !== 0) {
    return { ok: false, error: 'fields["Issue Number"] required' };
  }

  const found = await findBitableRecord({ appId, appSecret, appToken, tableId, issueNumber, fetcher });
  if (!found.ok) return { ok: false, error: found.error };

  if (found.recordId) {
    const result = await feishuFetch(
      `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/${found.recordId}`,
      { method: 'PUT', body: { fields }, appId, appSecret, fetcher },
    );
    if (!result.ok || result.json.code !== 0) {
      return {
        ok: false,
        error: `update failed: code=${result.json.code} msg=${result.json.msg || 'n/a'}`,
      };
    }
    return { ok: true, action: 'update', recordId: found.recordId };
  }

  const result = await feishuFetch(
    `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records`,
    { method: 'POST', body: { fields }, appId, appSecret, fetcher },
  );
  if (!result.ok || result.json.code !== 0) {
    return {
      ok: false,
      error: `create failed: code=${result.json.code} msg=${result.json.msg || 'n/a'}`,
    };
  }
  return { ok: true, action: 'create', recordId: result.json?.data?.record?.record_id };
}

// ---------------------------------------------------------------------------
// Main (PR-3: dispatches on EVENT_TYPE; bitable upsert for Issue lifecycle)
// ---------------------------------------------------------------------------

function writeOutput(key, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

async function main() {
  if (!hasRequiredFeishuInputs()) {
    log('INFO', `FEISHU_APP_ID missing — silent skip (event=${EVENT_TYPE}, issue=${ISSUE_NUMBER || 'n/a'})`);
    writeOutput('sync-status', 'noop');
    return;
  }

  // PR-2: chat notification events. PR-3: bitable mirror events.
  const NOTIFY_EVENTS = new Set([
    'workflow_run.completed',
    'pull_request.reviewed',
    'feishu-smoke',
  ]);
  const BITABLE_EVENTS = new Set([
    'issues.opened',
    'issues.labeled',
    'issues.unlabeled',
    'issues.edited',
    'issues.closed',
    'issues.reopened',
    'workflow_run.completed', // also mirrors to Bitable on every module completion
    'feishu-bitable-smoke',
  ]);

  // Bitable mirror path (PR-3)
  if (BITABLE_EVENTS.has(EVENT_TYPE) && FEISHU_BITABLE_APP_TOKEN && FEISHU_BITABLE_TABLE_ID && ISSUE_NUMBER) {
    const fields = renderIssueRow({
      number: ISSUE_NUMBER,
      title: process.env.ISSUE_TITLE || `Issue #${ISSUE_NUMBER}`,
      state: process.env.ISSUE_STATE || 'open',
      labels: (process.env.ISSUE_LABELS_CSV || '').split(',').map(s => s.trim()).filter(Boolean),
      assignees: (process.env.ISSUE_ASSIGNEES_CSV || '').split(',').map(s => s.trim()).filter(Boolean),
      updatedAt: process.env.ISSUE_UPDATED_AT || new Date().toISOString(),
    });
    const upsert = await bitableUpsert({
      appId: FEISHU_APP_ID,
      appSecret: process.env.FEISHU_APP_SECRET,
      appToken: FEISHU_BITABLE_APP_TOKEN,
      tableId: FEISHU_BITABLE_TABLE_ID,
      fields,
    });
    if (!upsert.ok) {
      fail(`bitableUpsert failed: ${upsert.error}`);
      writeOutput('sync-status', 'error');
      return;
    }
    log('INFO', `bitableUpsert ${upsert.action} (record_id=${upsert.recordId}, issue=#${ISSUE_NUMBER})`);
    // Bitable upsert succeeds — fall through to notification path if event is also a notify event
  } else if (BITABLE_EVENTS.has(EVENT_TYPE) && (!FEISHU_BITABLE_APP_TOKEN || !FEISHU_BITABLE_TABLE_ID)) {
    log('INFO', `event=${EVENT_TYPE} is a Bitable event but FEISHU_BITABLE_APP_TOKEN/TABLE_ID missing — skipping mirror`);
  }

  // Notification path (PR-2)
  if (!NOTIFY_EVENTS.has(EVENT_TYPE)) {
    // Pure bitable event with no chat notification needed
    if (BITABLE_EVENTS.has(EVENT_TYPE)) {
      writeOutput('sync-status', 'sync');
      return;
    }
    log('INFO', `event=${EVENT_TYPE} not in notify or bitable set — skeleton-noop`);
    writeOutput('sync-status', 'skeleton-noop');
    return;
  }

  if (!FEISHU_CHAT_ID) {
    log('WARN', `EVENT_TYPE=${EVENT_TYPE} requires FEISHU_CHAT_ID — skipping (set the secret to enable notifications)`);
    writeOutput('sync-status', 'noop');
    return;
  }

  const prNumber = process.env.PR_NUMBER || ISSUE_NUMBER || 'n/a';
  const prTitle = process.env.PR_TITLE || '(no title)';
  const prUrl = process.env.PR_URL || `https://github.com/${process.env.GITHUB_REPOSITORY || 'owner/repo'}`;
  const reviewer = process.env.PR_REVIEWER || '';
  const verdict = process.env.PR_VERDICT || 'completed';

  const card = renderReviewCard({ prNumber, prTitle, prUrl, reviewer, verdict });
  const result = await postCard({
    chatId: FEISHU_CHAT_ID,
    msgType: card.msg_type,
    content: card.content,
    appId: FEISHU_APP_ID,
    appSecret: process.env.FEISHU_APP_SECRET,
  });

  if (!result.ok) {
    fail(`postCard failed: ${result.error || `status=${result.status}`}`);
    writeOutput('sync-status', 'error');
    return;
  }

  log('INFO', `postCard delivered (message_id=${result.messageId}, chat=${FEISHU_CHAT_ID})`);
  writeOutput('sync-status', 'sync');
}

// Run only when invoked directly (not when imported by tests)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => fail(`sync.mjs main threw: ${err.message}`));
}
