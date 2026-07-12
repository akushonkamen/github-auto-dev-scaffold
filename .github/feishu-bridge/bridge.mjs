#!/usr/bin/env node
/**
 * bridge.mjs — Feishu bridge process (Phase A: single-instance per machine)
 *
 * Responsibilities:
 *   1. Acquire single-instance lockfile (~/.feishu-bridge/identity-store.json.lock)
 *   2. Resolve AES-256-GCM master key from OS keychain (NEVER from env — P3)
 *   3. Establish Feishu SDK WebSocket long connection
 *   4. Route incoming messages via parseCommand + routeCommand
 *   5. On SIGTERM/SIGINT: wipe master key buffer + close SDK + release lock
 *
 * Required environment (App credentials — these are NOT the master key, so env is fine):
 *   FEISHU_APP_ID            — App ID (cli_xxx)
 *   FEISHU_APP_SECRET        — App secret
 *
 * Forbidden environment (P3 red line):
 *   FEISHU_BRIDGE_MASTER_KEY — must NOT be set; bridge refuses to start if present
 *
 * Master key setup (run once per machine):
 *   openssl rand -hex 32 | tr -d '\n' | security add-generic-password -U \
 *     -s feishu-bridge -a master-key -w
 *
 * Launch:
 *   pm2 start bridge.mjs --name feishu-bridge
 *   pm2 logs feishu-bridge
 */
import { Buffer } from 'node:buffer';
import {
  resolveMasterKey,
  acquireLock,
  bind,
  unbind,
  lookup,
  wipeBuffer,
} from './identity-store.mjs';
import { parseCommand, routeCommand } from './router.mjs';
import { fetchCodeownersWithEtag } from './commands/approve.mjs';
import { handleApproveButton, APPROVE_ACTION } from './card-actions/approve-button.mjs';
import { handleRequestChangesButton, REQUEST_CHANGES_ACTION } from './card-actions/request-changes.mjs';

// Default CODEOWNERS path inside the bound repo
const CODEOWNERS_PATH = process.env.FEISHU_CODEOWNERS_PATH || '.github/CODEOWNERS';

const REQUIRED_ENV = ['FEISHU_APP_ID', 'FEISHU_APP_SECRET'];
const FORBIDDEN_MASTER_KEY_ENV = [
  'FEISHU_BRIDGE_MASTER_KEY',
  'MASTER_KEY',
  'FEISHU_MASTER_KEY',
];

const sessions = new Map();
// ETag cache for CODEOWNERS fetch — per-call GET + If-None-Match (S7: never trust
// local-only cache). Cache is updated after each /approve call.
const codeownersCache = { etag: null, content: null };
let masterKey = null;
let masterKeySource = null;
let releaseLock = null;
let larkClient = null;
let larkWs = null;
let shuttingDown = false;

// ---------------------------------------------------------------------------
// Shutdown
// ---------------------------------------------------------------------------

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[bridge] received ${signal}, shutting down`);

  // S4: wipe master key buffer ASAP
  if (masterKey) {
    wipeBuffer(masterKey);
    masterKey = null;
  }

  // Close Feishu SDK connection
  try {
    if (larkWs?.close) await larkWs.close();
  } catch (e) {
    console.error('[bridge] error closing SDK WebSocket:', e.message);
  }

  // Release lockfile
  try {
    if (releaseLock) await releaseLock();
  } catch (e) {
    console.error('[bridge] error releasing lock:', e.message);
  }

  console.log(`[bridge] ${signal} handled cleanly, exit 0`);
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

// ---------------------------------------------------------------------------
// Incoming message handler
// ---------------------------------------------------------------------------

/**
 * Build injected deps for /approve. Lazily imports Octokit to keep boot fast.
 * Cache reference shared with onMessage via module-level codeownersCache.
 */
function buildApproveDeps() {
  return {
    createOctokit: async (pat) => {
      const { Octokit } = await import('@octokit/rest');
      return new Octokit({ auth: pat });
    },
    fetchPRFiles: async (octokit, owner, repo, prNumber) => {
      const files = await octokit.paginate(
        'GET /repos/{owner}/{repo}/pulls/{pull_number}/files',
        { owner, repo, pull_number: prNumber, per_page: 100 },
        (response) => response.data.map((f) => f.filename),
      );
      return files;
    },
    fetchCodeowners: async (octokit, owner, repo, cache) => {
      const r = await fetchCodeownersWithEtag({
        octokit, owner, repo, path: CODEOWNERS_PATH, cache: cache ?? codeownersCache,
      });
      // Update cache on hit-or-miss for next call
      codeownersCache.etag = r.etag;
      codeownersCache.content = r.content;
      return r;
    },
    postReview: async (octokit, owner, repo, prNumber, event) => {
      return octokit.request('POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews', {
        owner, repo, pull_number: prNumber, event,
      });
    },
    postIssueComment: async (octokit, owner, repo, issueNumber, body) => {
      return octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', {
        owner, repo, issue_number: issueNumber, body,
      });
    },
    cache: codeownersCache,
  };
}

async function onMessage(event) {
  // Feishu schema 2.0: payload is { header, event: { sender, message } }
  // Also tolerate legacy 1.0 where message/sender sit at top level.
  const ev = event?.event ?? event;
  const msg = ev?.message;
  const sender = ev?.sender;
  if (!msg || !sender) {
    return;
  }

  const openId = sender.sender_id?.open_id;
  if (!openId) return;

  // Only handle P2P messages; group chat is Phase B
  if (msg.chat_id && msg.chat_type === 'group') {
    return; // ignore groups in Phase A
  }

  let text = '';
  try {
    const content = JSON.parse(msg.content || '{}');
    text = content.text || '';
  } catch {
    return; // ignore non-text content in Phase A
  }

  const parsed = parseCommand(text);
  if (!parsed) return; // not a command — ignore silently

  const result = await routeCommand({
    parsed,
    sessions,
    masterKey,
    deps: { bind, unbind, lookup },
    approveDeps: parsed.command === 'approve' ? buildApproveDeps() : null,
    bindRepo: process.env.FEISHU_BIND_REPO || null,
    openId,
  });

  if (!result?.reply) return;

  // Send reply via Feishu im.message.create
  try {
    await larkClient.im.message.create({
      params: { receive_id_type: 'open_id' },
      data: {
        receive_id: openId,
        msg_type: 'text',
        content: JSON.stringify({ text: result.reply }),
      },
    });
  } catch (e) {
    console.error('[bridge] reply send failed:', e.message);
  }
}

// ---------------------------------------------------------------------------
// Card action handler (PR-6) — interactive buttons on review.completed cards
// ---------------------------------------------------------------------------

/**
 * onCardAction — handles `card.action.trigger` events from interactive cards.
 *
 * Feishu always sends `action.tag === 'button'` for button clicks (the tag is
 * the *element type*, not our semantic name). The semantic action is in
 * `action.value.action`:
 *   - 'approve'           → handleApproveButton
 *   - 'request_changes'   → handleRequestChangesButton
 *
 * Each button's `value` also carries { owner, repo, pr_number } for routing.
 *
 * Replies go back to the clicking user via DM (open_id from operator).
 */
async function onCardAction(event) {
  // Schema 2.0: event.event.{operator, action, token, context}
  // Schema 1.0: top-level { operator, action, ... }
  const ev = event?.event ?? event;
  const action = ev?.action;
  const operator = ev?.operator;
  if (!action || !operator) return;

  const openId = operator.open_id;
  if (!openId) return;

  // Defensive: only handle button clicks. Overflow/select menus etc. ignored.
  if (action.tag && action.tag !== 'button') {
    console.log(`[bridge] ignoring non-button card action tag: ${action.tag}`);
    return;
  }

  const semanticAction = action.value?.action;
  const deps = buildApproveDeps();

  let result;
  try {
    if (semanticAction === APPROVE_ACTION) {
      result = await handleApproveButton({
        action, openId, masterKey, lookupFn: lookup, deps,
      });
    } else if (semanticAction === REQUEST_CHANGES_ACTION) {
      result = await handleRequestChangesButton({
        action, openId, masterKey, lookupFn: lookup, deps,
      });
    } else {
      // Unknown semantic action — log and ignore (no reply to avoid spam)
      console.log(`[bridge] unknown card action value.action: ${JSON.stringify(semanticAction)}`);
      return;
    }
  } catch (e) {
    console.error(`[bridge] card action "${semanticAction}" failed:`, e.message);
    result = { reply: `Action failed: ${e.message}` };
  }

  if (!result?.reply) return;

  try {
    await larkClient.im.message.create({
      params: { receive_id_type: 'open_id' },
      data: {
        receive_id: openId,
        msg_type: 'text',
        content: JSON.stringify({ text: result.reply }),
      },
    });
  } catch (e) {
    console.error('[bridge] card-action reply send failed:', e.message);
  }
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

async function preflightEnv() {
  // Forbidden master-key env vars (P3 red line)
  for (const name of FORBIDDEN_MASTER_KEY_ENV) {
    if (process.env[name]) {
      throw new Error(
        `Refusing to start: ${name} is set in env. Master key MUST come from OS keychain, not env (P3 red line).`,
      );
    }
  }
  // Required app-credential env vars (these are NOT secrets we control — they're app credentials)
  const missing = REQUIRED_ENV.filter((n) => !process.env[n]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required env: ${missing.join(', ')}. ` +
        `Set them in pm2 ecosystem.config.js or shell before launching bridge.`,
    );
  }
}

async function start() {
  console.log('[bridge] starting (Phase A — single instance per machine)');

  await preflightEnv();

  // 1. Lock — single instance invariant
  releaseLock = await acquireLock();
  console.log('[bridge] acquired single-instance lock');

  // 2. Master key — never env
  const resolved = await resolveMasterKey();
  masterKey = resolved.key;
  masterKeySource = resolved.source;
  console.log(`[bridge] master_key_source=${masterKeySource}`);
  if (masterKeySource === 'env') {
    // Should be unreachable — resolveMasterKey never returns 'env' — but defense in depth.
    throw new Error('master key source must not be env (P3 red line)');
  }

  // 3. Feishu SDK long connection
  let lark;
  try {
    lark = await import('@larksuiteoapi/node-sdk');
  } catch (e) {
    throw new Error(
      `@larksuiteoapi/node-sdk not installed. Run \`npm install\` in .github/feishu-bridge/. (${e.message})`,
    );
  }

  larkClient = new lark.Client({
    appId: process.env.FEISHU_APP_ID,
    appSecret: process.env.FEISHU_APP_SECRET,
    appType: lark.AppType.SelfBuild,
    domain: lark.Domain.Feishu,
  });

  // Register message handler + open WebSocket
  const wsClient = new lark.WSClient({
    appId: process.env.FEISHU_APP_ID,
    appSecret: process.env.FEISHU_APP_SECRET,
    domain: lark.Domain.Feishu,
  });

  await wsClient.start({
    eventDispatcher: new lark.EventDispatcher({})
      .register({
        'im.message.receive_v1': async (event) => onMessage(event),
        'im.message.receive_v2': async (event) => onMessage(event),
        'card.action.trigger': async (event) => onCardAction(event),
      }),
  });
  larkWs = wsClient;
  console.log('[bridge] WebSocket long connection established');
  console.log('[bridge] ready — listening for /bind /set-pat /unbind /status /approve + card actions');
}

start().catch((e) => {
  console.error('[bridge] fatal startup error:', e.message);
  // Best-effort cleanup
  if (masterKey) wipeBuffer(masterKey);
  if (releaseLock) releaseLock().catch(() => {});
  process.exit(1);
});

export { shutdown, onMessage, onCardAction };
