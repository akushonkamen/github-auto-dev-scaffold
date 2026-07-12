/**
 * bind.test.mjs — unit tests for /bind / /set-pat / /unbind / /status handlers
 *
 * Mocks GitHub search API and identity-store functions. Verifies:
 *   - /bind starts session + emits prompt with magic comment
 *   - /set-pat without active session rejects cleanly
 *   - /set-pat before comment-verification rejects
 *   - /set-pat with classic PAT (ghp_/hex) rejects
 *   - /set-pat with malformed PAT rejects
 *   - /set-pat receipt ALWAYS masks PAT (S4)
 *   - /set-pat calls identity-store.bind with correct args
 *   - /set-pat clears session on success
 *   - searchBindComment matches magic comment + verifies author
 *   - searchBindComment ignores comments by other authors
 *   - validatePATFormat accepts fine-grained, rejects classic
 *   - maskPAT replaces all PAT substrings with github_pat_***
 *   - session expiry (30 min) invalidates stale session
 *   - promoteToAwaitingPat only works from awaiting_comment state
 *   - /status shows bound state without PAT
 *   - /unbind handles missing binding gracefully
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  handleBind,
  handleSetPat,
  handleUnbind,
  handleStatus,
  searchBindComment,
  validatePATFormat,
  maskPAT,
  promoteToAwaitingPat,
  clearSession,
  __internal,
} from '../commands/bind.mjs';

const { newSessions, SESSION_TTL_MS } = __internal;

// ---------------------------------------------------------------------------
// maskPAT
// ---------------------------------------------------------------------------

test('maskPAT replaces github_pat_xxx with github_pat_***', () => {
  const out = maskPAT('error: github_pat_11ABCDabcdef12345 rejected');
  assert.equal(out, 'error: github_pat_*** rejected');
});

test('maskPAT replaces multiple occurrences', () => {
  const out = maskPAT('a github_pat_aaa b github_pat_bbb');
  assert.equal(out, 'a github_pat_*** b github_pat_***');
});

test('maskPAT leaves non-PAT strings untouched', () => {
  assert.equal(maskPAT('plain text no secrets'), 'plain text no secrets');
});

test('maskPAT handles non-string input', () => {
  assert.equal(maskPAT(null), null);
  assert.equal(maskPAT(undefined), undefined);
  assert.equal(maskPAT(42), 42);
});

// ---------------------------------------------------------------------------
// validatePATFormat
// ---------------------------------------------------------------------------

test('validatePATFormat accepts valid fine-grained PAT', () => {
  const r = validatePATFormat('github_pat_' + 'a'.repeat(80));
  assert.equal(r.ok, true);
});

test('validatePATFormat rejects classic ghp_ prefix', () => {
  const r = validatePATFormat('ghp_abc12345');
  assert.equal(r.ok, false);
  assert.match(r.reason, /fine-grained PAT required/);
});

test('validatePATFormat rejects hex token (no prefix)', () => {
  const r = validatePATFormat('abcdef0123456789abcdef0123456789abcdef01');
  assert.equal(r.ok, false);
  assert.match(r.reason, /fine-grained PAT required/);
});

test('validatePATFormat rejects too-short fine-grained', () => {
  const r = validatePATFormat('github_pat_short');
  assert.equal(r.ok, false);
  assert.match(r.reason, /40\+ word chars/);
});

test('validatePATFormat rejects non-string', () => {
  assert.equal(validatePATFormat(null).ok, false);
  assert.equal(validatePATFormat(undefined).ok, false);
  assert.equal(validatePATFormat(123).ok, false);
});

// ---------------------------------------------------------------------------
// searchBindComment
// ---------------------------------------------------------------------------

test('searchBindComment returns first match by author + body', async () => {
  const fakeApi = {
    async search(query) {
      assert.match(query, /feishu-bind:ou_alice_123 in:comment author:alice/);
      return [
        { author: 'alice', body: 'random comment', repo: 'r1', number: 1 },
        { author: 'alice', body: 'feishu-bind:ou_alice_123', repo: 'r2', number: 5 },
      ];
    },
  };
  const r = await searchBindComment({ githubApi: fakeApi, openId: 'ou_alice_123', githubUser: 'alice' });
  assert.equal(r.found, true);
  assert.equal(r.repo, 'r2');
  assert.equal(r.number, 5);
  assert.equal(r.author, 'alice');
});

test('searchBindComment returns not-found when no author match', async () => {
  const fakeApi = {
    async search() {
      return [{ author: 'bob', body: 'feishu-bind:ou_alice_123', repo: 'r', number: 1 }];
    },
  };
  const r = await searchBindComment({ githubApi: fakeApi, openId: 'ou_alice_123', githubUser: 'alice' });
  assert.equal(r.found, false);
});

test('searchBindComment returns not-found when body missing magic token', async () => {
  const fakeApi = {
    async search() {
      return [{ author: 'alice', body: 'unrelated', repo: 'r', number: 1 }];
    },
  };
  const r = await searchBindComment({ githubApi: fakeApi, openId: 'ou_alice_123', githubUser: 'alice' });
  assert.equal(r.found, false);
});

test('searchBindComment returns not-found on empty results', async () => {
  const fakeApi = { async search() { return []; } };
  const r = await searchBindComment({ githubApi: fakeApi, openId: 'ou_x', githubUser: 'y' });
  assert.equal(r.found, false);
});

// ---------------------------------------------------------------------------
// handleBind
// ---------------------------------------------------------------------------

test('handleBind without args returns usage prompt', async () => {
  const sessions = newSessions();
  const r = await handleBind({ openId: 'ou_x', args: [], sessions });
  assert.match(r.reply, /Usage: \/bind/);
  assert.equal(sessions.size, 0);
});

test('handleBind with valid username starts awaiting_comment session', async () => {
  const sessions = newSessions();
  const r = await handleBind({ openId: 'ou_alice', args: ['alice'], sessions });
  assert.match(r.reply, /Binding Feishu → GitHub/);
  assert.match(r.reply, /feishu-bind:ou_alice/);
  assert.equal(sessions.size, 1);
  const s = sessions.get('ou_alice');
  assert.equal(s.state, 'awaiting_comment');
  assert.equal(s.github_user, 'alice');
  assert.equal(s.open_id, 'ou_alice');
  assert.ok(s.started_at > 0);
});

test('handleBind rejects invalid username chars', async () => {
  const sessions = newSessions();
  const r = await handleBind({ openId: 'ou_x', args: ['Bad!Username'], sessions });
  assert.match(r.reply, /Invalid GitHub username/);
  assert.equal(sessions.size, 0);
});

test('handleBind lowercases GitHub username', async () => {
  const sessions = newSessions();
  const r = await handleBind({ openId: 'ou_x', args: ['Alice'], sessions });
  assert.equal(sessions.get('ou_x').github_user, 'alice');
});

// ---------------------------------------------------------------------------
// handleSetPat
// ---------------------------------------------------------------------------

test('handleSetPat without args returns usage', async () => {
  const sessions = newSessions();
  const r = await handleSetPat({ openId: 'ou_x', args: [], sessions, masterKey: null, bindFn: null });
  assert.match(r.reply, /Usage: \/set-pat/);
});

test('handleSetPat without active session rejects', async () => {
  const sessions = newSessions();
  const r = await handleSetPat({
    openId: 'ou_x',
    args: ['github_pat_' + 'a'.repeat(80)],
    sessions,
    masterKey: Buffer.alloc(32, 1),
    bindFn: async () => ({}),
  });
  assert.match(r.reply, /No active bind session/);
});

test('handleSetPat in awaiting_comment state rejects (still need verification)', async () => {
  const sessions = newSessions();
  sessions.set('ou_x', { state: 'awaiting_comment', github_user: 'alice', open_id: 'ou_x', started_at: Date.now() });
  const r = await handleSetPat({
    openId: 'ou_x',
    args: ['github_pat_' + 'a'.repeat(80)],
    sessions,
    masterKey: Buffer.alloc(32, 1),
    bindFn: async () => ({}),
  });
  assert.match(r.reply, /still in state "awaiting_comment"/);
});

test('handleSetPat with classic PAT rejects', async () => {
  const sessions = newSessions();
  sessions.set('ou_x', { state: 'awaiting_pat', github_user: 'alice', open_id: 'ou_x', started_at: Date.now() });
  const r = await handleSetPat({
    openId: 'ou_x',
    args: ['ghp_classic_token_value'],
    sessions,
    masterKey: Buffer.alloc(32, 1),
    bindFn: async () => { throw new Error('should not call bindFn'); },
  });
  assert.match(r.reply, /classic tokens rejected/);
  // session must NOT be cleared on PAT rejection
  assert.ok(sessions.has('ou_x'));
});

test('handleSetPat success stores PAT and clears session', async () => {
  const sessions = newSessions();
  sessions.set('ou_x', { state: 'awaiting_pat', github_user: 'alice', open_id: 'ou_x', started_at: Date.now() });
  const masterKey = Buffer.alloc(32, 5);
  let bindArgs = null;
  const bindFn = async (a) => {
    bindArgs = a;
    return { open_id_hash: 'abc', github_user: a.githubUser, bound_at: 'now' };
  };
  const r = await handleSetPat({
    openId: 'ou_x',
    args: ['github_pat_' + 'a'.repeat(80)],
    sessions,
    masterKey,
    bindFn,
  });
  assert.match(r.reply, /Bound ✅/);
  assert.match(r.reply, /github_pat_\*\*\*/);
  assert.equal(bindArgs.githubUser, 'alice');
  assert.equal(bindArgs.openId, 'ou_x');
  assert.equal(bindArgs.masterKey, masterKey);
  assert.equal(sessions.size, 0, 'session cleared on success');
});

test('handleSetPat receipt NEVER reveals the real PAT (S4 red line)', async () => {
  const sessions = newSessions();
  sessions.set('ou_x', { state: 'awaiting_pat', github_user: 'alice', open_id: 'ou_x', started_at: Date.now() });
  // 80 chars after prefix → passes validation
  const realPAT = 'github_pat_11VERYSECRETvalue1234567890ABCDEFGHIJKabcdefghijklmnopqrstuvwxyz0123456789AB';
  const r = await handleSetPat({
    openId: 'ou_x',
    args: [realPAT],
    sessions,
    masterKey: Buffer.alloc(32, 5),
    bindFn: async () => ({}),
  });
  // Receipt must NOT contain the real PAT
  assert.doesNotMatch(r.reply, new RegExp(realPAT));
  assert.match(r.reply, /github_pat_\*\*\*/);
});

test('handleSetPat on bindFn error reports masked message + keeps session', async () => {
  const sessions = newSessions();
  sessions.set('ou_x', { state: 'awaiting_pat', github_user: 'alice', open_id: 'ou_x', started_at: Date.now() });
  const r = await handleSetPat({
    openId: 'ou_x',
    args: ['github_pat_' + 'a'.repeat(80)],
    sessions,
    masterKey: Buffer.alloc(32, 5),
    bindFn: async () => { throw new Error('keychain locked github_pat_leaked_value'); },
  });
  assert.match(r.reply, /Bind failed/);
  assert.match(r.reply, /github_pat_\*\*\*/);
  assert.doesNotMatch(r.reply, /github_pat_leaked_value/);
  // session preserved so user can retry
  assert.ok(sessions.has('ou_x'));
});

test('handleSetPat rejects expired session (>30min)', async () => {
  const sessions = newSessions();
  const longAgo = Date.now() - (SESSION_TTL_MS + 60_000);
  sessions.set('ou_x', { state: 'awaiting_pat', github_user: 'alice', open_id: 'ou_x', started_at: longAgo });
  const r = await handleSetPat({
    openId: 'ou_x',
    args: ['github_pat_' + 'a'.repeat(80)],
    sessions,
    masterKey: Buffer.alloc(32, 5),
    bindFn: async () => { throw new Error('should not reach'); },
  });
  assert.match(r.reply, /No active bind session/);
  assert.equal(sessions.size, 0, 'expired session deleted');
});

// ---------------------------------------------------------------------------
// promoteToAwaitingPat
// ---------------------------------------------------------------------------

test('promoteToAwaitingPat advances from awaiting_comment', () => {
  const sessions = newSessions();
  sessions.set('ou_x', { state: 'awaiting_comment', started_at: Date.now() });
  const ok = promoteToAwaitingPat({ sessions, openId: 'ou_x' });
  assert.equal(ok, true);
  assert.equal(sessions.get('ou_x').state, 'awaiting_pat');
  assert.ok(sessions.get('ou_x').verified_at > 0);
});

test('promoteToAwaitingPat refuses from non-awaiting_comment state', () => {
  const sessions = newSessions();
  sessions.set('ou_x', { state: 'awaiting_pat', started_at: Date.now() });
  const ok = promoteToAwaitingPat({ sessions, openId: 'ou_x' });
  assert.equal(ok, false);
});

test('promoteToAwaitingPat returns false for missing session', () => {
  const sessions = newSessions();
  const ok = promoteToAwaitingPat({ sessions, openId: 'never' });
  assert.equal(ok, false);
});

// ---------------------------------------------------------------------------
// clearSession
// ---------------------------------------------------------------------------

test('clearSession removes existing session', () => {
  const sessions = newSessions();
  sessions.set('ou_x', { state: 'awaiting_comment', started_at: Date.now() });
  const removed = clearSession({ sessions, openId: 'ou_x' });
  assert.equal(removed, true);
  assert.equal(sessions.size, 0);
});

test('clearSession returns false for missing session', () => {
  const sessions = newSessions();
  const removed = clearSession({ sessions, openId: 'never' });
  assert.equal(removed, false);
});

// ---------------------------------------------------------------------------
// handleUnbind
// ---------------------------------------------------------------------------

test('handleUnbind reports success when binding existed', async () => {
  let unbindCalled = false;
  const r = await handleUnbind({
    openId: 'ou_x',
    unbindFn: async ({ openId }) => { unbindCalled = true; assert.equal(openId, 'ou_x'); return true; },
  });
  assert.equal(unbindCalled, true);
  assert.match(r.reply, /Unbound/);
});

test('handleUnbind reports not-found when no binding', async () => {
  const r = await handleUnbind({
    openId: 'ou_x',
    unbindFn: async () => false,
  });
  assert.match(r.reply, /No binding found/);
});

// ---------------------------------------------------------------------------
// handleStatus
// ---------------------------------------------------------------------------

test('handleStatus reports NOT BOUND when lookup returns null', async () => {
  const r = await handleStatus({
    openId: 'ou_x',
    masterKey: Buffer.alloc(32, 1),
    lookupFn: async () => null,
  });
  assert.match(r.reply, /NOT BOUND/);
});

test('handleStatus reports BOUND without revealing PAT', async () => {
  const r = await handleStatus({
    openId: 'ou_x',
    masterKey: Buffer.alloc(32, 1),
    lookupFn: async () => ({ github_user: 'alice', bound_at: '2026-07-11T00:00:00Z', pat: Buffer.from('x') }),
  });
  assert.match(r.reply, /BOUND/);
  assert.match(r.reply, /alice/);
  assert.match(r.reply, /github_pat_\*\*\*/);
  // Should never reveal actual PAT bytes
  assert.doesNotMatch(r.reply, /github_pat_[a-zA-Z0-9_]{10,}/);
});
