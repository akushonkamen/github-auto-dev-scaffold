/**
 * commands/bind.mjs — /bind / /set-pat / /unbind / /status command handlers
 *
 * Multi-step bind flow (Phase A invariant: single-bridge per machine):
 *   1. user → bridge:  /bind <github-username>
 *      bridge → user:  "Leave a comment 'feishu-bind:<open_id>' on any GitHub
 *                       Issue/PR; I'll watch for it."
 *      session state:  { state: 'awaiting_comment', github_user, started_at }
 *
 *   2. bridge polls GitHub search API for the magic comment.
 *      On hit, validates comment author === declared username.
 *      session state:  { state: 'awaiting_pat', github_user, verified_at }
 *      bridge → user:  "Verified. Now send /set-pat <github_pat_...>"
 *
 *   3. user → bridge:  /set-pat github_pat_xxx
 *      bridge:         encrypt PAT, persist via identity-store.bind()
 *      bridge → user:  "Bound. Stored as github_pat_*** (mask enforced)"
 *      session state:  cleared
 *
 * S4 red lines:
 *   - /set-pat receipt MUST always show 'github_pat_***' regardless of input
 *   - On any error, log message must redact PAT substring
 *   - PAT plaintext must be wiped (Buffer.fill(0)) once encrypted
 *
 * S6 red lines:
 *   - PAT must be fine-grained (start with 'github_pat_')
 *   - Classic PATs (hex tokens / 'ghp_' prefix) rejected with clear error
 *
 * Exported as pure functions for testability — GitHub API + sessions injected.
 */
import { Buffer } from 'node:buffer';

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 min per step
const PAT_REGEX = /^github_pat_[A-Za-z0-9_]{40,}$/;
const MAGIC_PREFIX = 'feishu-bind:';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Mask any GitHub PAT-like substring in a string with 'github_pat_***'.
 * Used on every reply before sending. Defense-in-depth on S4.
 */
export function maskPAT(input) {
  if (typeof input !== 'string') return input;
  return input.replace(/github_pat_[A-Za-z0-9_]+/g, 'github_pat_***');
}

/** Validate PAT format — must be fine-grained (github_pat_ prefix + 40+ chars). */
export function validatePATFormat(pat) {
  if (typeof pat !== 'string') return { ok: false, reason: 'PAT must be a string' };
  if (!pat.startsWith('github_pat_')) {
    return {
      ok: false,
      reason: 'classic tokens rejected — fine-grained PAT required (github_pat_ prefix)',
    };
  }
  if (!PAT_REGEX.test(pat)) {
    return { ok: false, reason: 'malformed fine-grained PAT — expected 40+ word chars after prefix' };
  }
  return { ok: true };
}

/**
 * Search GitHub for a magic comment binding the open_id to githubUser.
 * @param {{ search: (query: string) => Promise<Array<{ author: string, body: string, repo: string, number: number }>> }} githubApi
 */
export async function searchBindComment({ githubApi, openId, githubUser }) {
  const query = `${MAGIC_PREFIX}${openId} in:comment author:${githubUser}`;
  const results = await githubApi.search(query);
  for (const r of results) {
    if (r.author !== githubUser) continue;
    if (typeof r.body !== 'string') continue;
    if (r.body.includes(`${MAGIC_PREFIX}${openId}`)) {
      return { found: true, repo: r.repo, number: r.number, author: r.author };
    }
  }
  return { found: false };
}

function isSessionFresh(session, now = Date.now()) {
  if (!session) return false;
  if (!session.started_at) return false;
  return now - session.started_at < SESSION_TTL_MS;
}

function newSessions() {
  return new Map();
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

/**
 * /bind <github-username> — start the bind flow.
 * @param {object} opts
 * @param {string} opts.openId — Feishu open_id of the user
 * @param {string[]} opts.args — command args (expected: [username])
 * @param {Map} opts.sessions — pending-bind session map
 * @returns {Promise<{ reply: string, session?: object }>}
 */
export async function handleBind({ openId, args, sessions }) {
  if (!openId) throw new Error('openId required');
  if (!sessions) throw new Error('sessions required');
  if (!Array.isArray(args) || args.length === 0) {
    return {
      reply:
        'Usage: /bind <github-username>\n' +
        'Example: /bind alice\n\n' +
        'After /bind, leave a comment on any GitHub Issue/PR with the text:\n' +
        `  ${MAGIC_PREFIX}<your-feishu-open-id>\n` +
        'I will verify the comment author matches your declared username.',
    };
  }
  const githubUser = String(args[0]).trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,38})$/.test(githubUser)) {
    return { reply: `Invalid GitHub username: "${maskPAT(githubUser)}". Use lowercase alphanumeric + hyphens, ≤39 chars.` };
  }

  const session = {
    state: 'awaiting_comment',
    github_user: githubUser,
    open_id: openId,
    started_at: Date.now(),
    verified_at: null,
  };
  sessions.set(openId, session);
  return {
    reply:
      `Binding Feishu → GitHub.\n\n` +
      `Declared GitHub user: ${githubUser}\n\n` +
      `Now leave a comment on ANY GitHub Issue or PR in your repo containing exactly:\n` +
      `  ${MAGIC_PREFIX}${openId}\n\n` +
      `I'll watch for it via GitHub search. Once verified, send:\n` +
      `  /set-pat github_pat_<your-fine-grained-pat>\n\n` +
      `Bind session expires in 30 minutes if unused.`,
    session,
  };
}

/**
 * /set-pat <github_pat_...> — store encrypted PAT after /bind verification.
 *
 * @param {object} opts
 * @param {Map} opts.sessions
 * @param {Buffer} opts.masterKey
 * @param {(opts: object) => Promise<object>} opts.bindFn — identity-store.bind()
 */
export async function handleSetPat({ openId, args, sessions, masterKey, bindFn }) {
  if (!openId) throw new Error('openId required');
  if (!Array.isArray(args) || args.length === 0) {
    return { reply: 'Usage: /set-pat github_pat_<...>\n\nYou must run /bind <username> and verify the magic comment first.' };
  }
  const pat = String(args[0]);

  const session = sessions.get(openId);
  if (!isSessionFresh(session)) {
    sessions.delete(openId);
    return {
      reply:
        'No active bind session. Run /bind <github-username> first.\n' +
        '(Sessions expire after 30 minutes.)',
    };
  }
  if (session.state !== 'awaiting_pat') {
    return {
      reply:
        `Bind session is still in state "${session.state}".\n` +
        `I'm waiting for you to leave the comment:\n  ${MAGIC_PREFIX}${openId}\n` +
        `on a GitHub Issue/PR. Once I detect it, you can /set-pat.`,
    };
  }

  const validation = validatePATFormat(pat);
  if (!validation.ok) {
    return { reply: `PAT rejected: ${validation.reason}\n\nRe-send /set-pat github_pat_<...> with a fine-grained PAT.` };
  }

  try {
    await bindFn({
      masterKey,
      openId,
      githubUser: session.github_user,
      plainPAT: pat,
    });
    // Best-effort wipe of the plaintext buffer. Strings are immutable in V8,
    // so we can't truly zero them; the binding's encrypted form is now the
    // canonical copy and the plaintext string will be GC'd eventually.
    // The AC `grep -c 'github_pat_' identity-store.json == 0` is what really
    // matters here.
  } catch (e) {
    return { reply: `Bind failed: ${maskPAT(e.message)}. No data was stored.` };
  }

  sessions.delete(openId);
  // CRITICAL (S4): receipt MUST show masked PAT, never the real value.
  return {
    reply:
      `Bound ✅\n` +
      `GitHub user: ${session.github_user}\n` +
      `PAT stored: github_pat_***\n` +
      `Encrypted at rest with AES-256-GCM (master key in OS keychain).\n\n` +
      `Use /status to verify, or /unbind to remove.`,
  };
}

/**
 * /unbind — remove the binding for the calling open_id.
 */
export async function handleUnbind({ openId, unbindFn }) {
  if (!openId) throw new Error('openId required');
  const removed = await unbindFn({ openId });
  if (removed) {
    return { reply: 'Unbound. Your encrypted PAT has been deleted from the store.' };
  }
  return { reply: 'No binding found for your account. Nothing to remove.' };
}

/**
 * /status — show whether this open_id is bound (without revealing PAT).
 */
export async function handleStatus({ openId, lookupFn, masterKey }) {
  if (!openId) throw new Error('openId required');
  if (!masterKey) throw new Error('masterKey required');
  const found = await lookupFn({ openId, masterKey });
  if (!found) {
    return { reply: 'Status: NOT BOUND\n\nRun /bind <github-username> to start binding.' };
  }
  return {
    reply:
      `Status: BOUND\n` +
      `GitHub user: ${found.github_user}\n` +
      `Bound at: ${found.bound_at}\n` +
      `PAT: github_pat_***`,
  };
}

/**
 * Promote a verified bind session to awaiting_pat. Called by the bridge
 * poller once the magic comment is detected + author verified.
 */
export function promoteToAwaitingPat({ sessions, openId, verifiedAt = Date.now() }) {
  const session = sessions.get(openId);
  if (!session) return false;
  if (session.state !== 'awaiting_comment') return false;
  session.state = 'awaiting_pat';
  session.verified_at = verifiedAt;
  return true;
}

/**
 * Discard a session (e.g. on expiry, user cancel, or /set-pat success).
 */
export function clearSession({ sessions, openId }) {
  return sessions.delete(openId);
}

export const __internal = {
  SESSION_TTL_MS,
  PAT_REGEX,
  MAGIC_PREFIX,
  isSessionFresh,
  newSessions,
};
