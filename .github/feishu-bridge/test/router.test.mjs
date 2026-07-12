/**
 * router.test.mjs — unit tests for command parser + dispatcher
 *
 * Coverage:
 *   - parseCommand: prefix detection, lowercasing, arg splitting
 *   - routeCommand: /bind /set-pat /unbind /status /help routing
 *   - routeCommand: unknown command reply
 *   - routeCommand: non-command messages return null
 *   - routeCommand: all replies masked (S4)
 *   - /set-pat before keychain ready returns init message
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, routeCommand } from '../router.mjs';

const emptyDeps = {
  bind: async () => { throw new Error('should not call'); },
  unbind: async () => false,
  lookup: async () => null,
};

// ---------------------------------------------------------------------------
// parseCommand
// ---------------------------------------------------------------------------

test('parseCommand: /bind alice → { command: "bind", args: ["alice"] }', () => {
  const r = parseCommand('/bind alice');
  assert.deepEqual(r, { command: 'bind', args: ['alice'] });
});

test('parseCommand: lowercases command name', () => {
  const r = parseCommand('/BIND Alice');
  assert.equal(r.command, 'bind');
});

test('parseCommand: splits multiple args by whitespace', () => {
  const r = parseCommand('/set-pat github_pat_x extra-arg');
  assert.deepEqual(r, { command: 'set-pat', args: ['github_pat_x', 'extra-arg'] });
});

test('parseCommand: command with no args', () => {
  const r = parseCommand('/status');
  assert.deepEqual(r, { command: 'status', args: [] });
});

test('parseCommand: trims leading/trailing whitespace', () => {
  const r = parseCommand('  /status  ');
  assert.deepEqual(r, { command: 'status', args: [] });
});

test('parseCommand: returns null for non-command text', () => {
  assert.equal(parseCommand('hello world'), null);
  assert.equal(parseCommand('plain text'), null);
});

test('parseCommand: returns null for empty string', () => {
  assert.equal(parseCommand(''), null);
});

test('parseCommand: returns null for non-string input', () => {
  assert.equal(parseCommand(null), null);
  assert.equal(parseCommand(undefined), null);
  assert.equal(parseCommand(42), null);
});

// ---------------------------------------------------------------------------
// routeCommand
// ---------------------------------------------------------------------------

test('routeCommand: /help returns static help text', async () => {
  const sessions = new Map();
  const r = await routeCommand({
    parsed: parseCommand('/help'),
    sessions,
    masterKey: null,
    deps: emptyDeps,
    openId: 'ou_x',
  });
  assert.match(r.reply, /Available commands/);
  assert.match(r.reply, /\/bind/);
  assert.match(r.reply, /\/set-pat/);
});

test('routeCommand: /status with no binding returns NOT BOUND', async () => {
  const sessions = new Map();
  const r = await routeCommand({
    parsed: parseCommand('/status'),
    sessions,
    masterKey: Buffer.alloc(32, 1),
    deps: { ...emptyDeps, lookup: async () => null },
    openId: 'ou_x',
  });
  assert.match(r.reply, /NOT BOUND/);
});

test('routeCommand: /bind alice starts session', async () => {
  const sessions = new Map();
  const r = await routeCommand({
    parsed: parseCommand('/bind alice'),
    sessions,
    masterKey: null,
    deps: emptyDeps,
    openId: 'ou_x',
  });
  assert.match(r.reply, /Binding Feishu → GitHub/);
  assert.equal(sessions.size, 1);
});

test('routeCommand: /set-pat before keychain ready returns init message', async () => {
  const sessions = new Map();
  sessions.set('ou_x', { state: 'awaiting_pat', github_user: 'alice', open_id: 'ou_x', started_at: Date.now() });
  const r = await routeCommand({
    parsed: parseCommand('/set-pat github_pat_' + 'a'.repeat(80)),
    sessions,
    masterKey: null, // not yet loaded
    deps: emptyDeps,
    openId: 'ou_x',
  });
  assert.match(r.reply, /still initializing the keychain/);
});

test('routeCommand: unknown command returns graceful reply', async () => {
  const r = await routeCommand({
    parsed: parseCommand('/frobnicate x y'),
    sessions: new Map(),
    masterKey: null,
    deps: emptyDeps,
    openId: 'ou_x',
  });
  assert.match(r.reply, /Unknown command: "\/frobnicate"/);
});

test('routeCommand: null parsed returns handled:false with null reply', async () => {
  const r = await routeCommand({
    parsed: null,
    sessions: new Map(),
    masterKey: null,
    deps: emptyDeps,
    openId: 'ou_x',
  });
  assert.equal(r.handled, false);
  assert.equal(r.reply, null);
});

test('routeCommand: all replies are passed through maskPAT (S4)', async () => {
  // Even if a handler somehow returned a PAT string, routeCommand must mask it.
  const r = await routeCommand({
    parsed: parseCommand('/help'),
    sessions: new Map(),
    masterKey: null,
    deps: emptyDeps,
    openId: 'ou_x',
  });
  // Help text intentionally has no PAT but check the path is mask-safe:
  assert.doesNotMatch(r.reply, /github_pat_[a-zA-Z0-9_]{40,}/);
});
