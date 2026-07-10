import { test } from 'node:test';
import assert from 'node:assert/strict';

import { maybeRun, parseRemoteUrl, shellQuote } from '../lib/shell.mjs';

test('shellQuote allows safe subset unquoted', () => {
  assert.equal(shellQuote('owner/name'), 'owner/name');
  assert.equal(shellQuote('feature/foo-bar'), 'feature/foo-bar');
});

test('shellQuote quotes single quotes', () => {
  const q = shellQuote("a'b");
  assert.equal(q, "'a'\\''b'");
});

test('shellQuote empty string', () => {
  assert.equal(shellQuote(''), "''");
});

test('maybeRun dry-run returns dry:true without executing', async () => {
  const r = await maybeRun('echo', ['hello'], { dry: true, silent: true });
  assert.equal(r.dry, true);
  assert.equal(r.stdout, '');
});

test('maybeRun executes when not dry', async () => {
  const r = await maybeRun('echo', ['hello'], { silent: true });
  assert.equal(r.dry, false);
  assert.equal(r.stdout.trim(), 'hello');
});

test('maybeRun mask redacts secret args in errors', async () => {
  const secret = 'github_pat_supersecretvalue';
  try {
    await maybeRun('false', [], { mask: [secret], silent: true });
    assert.fail('should have thrown');
  } catch (err) {
    // false exits non-zero; err.wizardCommand should not leak the secret
    assert.equal(err.wizardCommand.includes(secret), false);
  }
});

test('parseRemoteUrl ssh form', () => {
  assert.equal(parseRemoteUrl('git@github.com:owner/repo.git'), 'owner/repo');
  assert.equal(parseRemoteUrl('git@github.com:owner/repo'), 'owner/repo');
});

test('parseRemoteUrl https form', () => {
  assert.equal(parseRemoteUrl('https://github.com/owner/repo.git'), 'owner/repo');
  assert.equal(parseRemoteUrl('https://github.com/owner/repo'), 'owner/repo');
});

test('parseRemoteUrl garbage returns null', () => {
  assert.equal(parseRemoteUrl('not a url'), null);
  assert.equal(parseRemoteUrl(''), null);
});
