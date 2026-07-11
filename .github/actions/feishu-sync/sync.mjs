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
// Main (PR-1 skeleton — real implementation lands in PR-2 / PR-3)
// ---------------------------------------------------------------------------

function writeOutput(key, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

async function main() {
  if (!hasRequiredFeishuInputs()) {
    // Silent skip — does NOT fail the workflow. Aligned with notion-sync
    // sync.mjs:410-418. Allows repos to merge feishu-sync action before
    // secrets are configured.
    log('INFO', `FEISHU_APP_ID missing — silent skip (event=${EVENT_TYPE}, issue=${ISSUE_NUMBER || 'n/a'})`);
    writeOutput('sync-status', 'noop');
    return;
  }

  // PR-2 will implement feishuFetch() + postCard()
  // PR-3 will implement bitable upsert()
  log('INFO', `feishu-sync skeleton ready (event=${EVENT_TYPE}, issue=${ISSUE_NUMBER || 'n/a'}, chat=${FEISHU_CHAT_ID || 'n/a'}) — real impl lands in PR-2`);
  writeOutput('sync-status', 'skeleton-noop');
}

// Run only when invoked directly (not when imported by tests)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => fail(`sync.mjs main threw: ${err.message}`));
}
