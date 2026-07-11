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
 * Build a text-card content payload for review-completed events.
 * Returns the JSON-stringified content for postCard.
 *
 * Card schema: msg_type=text (PR-2 minimal). PR-5 will upgrade to interactive
 * card with Approve/Request Changes buttons (disabled:true to avoid dead UI
 * before the bridge lands).
 *
 * @param {{prNumber: number|string, prTitle: string, prUrl: string, reviewer?: string, verdict?: 'approved'|'changes_requested'|'completed'}} ctx
 * @returns {{text: string}}
 */
export function renderReviewCard({ prNumber, prTitle, prUrl, reviewer, verdict }) {
  const verdictEmoji = {
    approved: '✅',
    changes_requested: '🔁',
    completed: '✅',
  }[verdict] || '🔔';

  const reviewerLine = reviewer ? `Reviewer: ${reviewer}\n` : '';
  const text = [
    `${verdictEmoji} PR #${prNumber} ${verdict || 'review'}`,
    ``,
    `${prTitle}`,
    ``,
    `${reviewerLine}`,
    `URL: ${prUrl}`,
  ].filter(Boolean).join('\n');

  return { text };
}

// ---------------------------------------------------------------------------
// Main (PR-2: dispatches on EVENT_TYPE; real impl for review-completed)
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

  // PR-2: only handle notification events. Bitable upsert lands in PR-3.
  const NOTIFY_EVENTS = new Set([
    'workflow_run.completed',
    'pull_request.reviewed',
    'feishu-smoke', // workflow_dispatch smoke trigger
  ]);

  if (!NOTIFY_EVENTS.has(EVENT_TYPE)) {
    log('INFO', `event=${EVENT_TYPE} not in notify set — skeleton-noop`);
    writeOutput('sync-status', 'skeleton-noop');
    return;
  }

  if (!FEISHU_CHAT_ID) {
    log('WARN', `EVENT_TYPE=${EVENT_TYPE} requires FEISHU_CHAT_ID — skipping (set the secret to enable notifications)`);
    writeOutput('sync-status', 'noop');
    return;
  }

  // Minimal context for the card. The observer workflow (feishu-notify.yml)
  // passes richer context via env vars when available; here we fall back to
  // ISSUE_NUMBER + workflow metadata.
  const prNumber = process.env.PR_NUMBER || ISSUE_NUMBER || 'n/a';
  const prTitle = process.env.PR_TITLE || '(no title)';
  const prUrl = process.env.PR_URL || `https://github.com/${process.env.GITHUB_REPOSITORY || 'owner/repo'}`;
  const reviewer = process.env.PR_REVIEWER || '';
  const verdict = process.env.PR_VERDICT || 'completed';

  const content = renderReviewCard({ prNumber, prTitle, prUrl, reviewer, verdict });
  const result = await postCard({
    chatId: FEISHU_CHAT_ID,
    msgType: 'text',
    content,
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
