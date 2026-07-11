/**
 * safe.test.mjs — Unit tests for safe() redaction
 *
 * Covers:
 *   - GitHub PAT formats: classic / fine-grained / OAuth / user / refresh
 *   - Feishu token formats: user (t-) / tenant (t-g) / client (t-cl) / cli_
 *   - Feishu App Secret: 32 hex chars
 *   - Generic secret_<32+> format (inherited from notion-sync)
 *   - Non-string passthrough
 *   - Multiple tokens in same string
 *   - Tokens embedded in structured JSON-like strings
 *
 * PR-1 only — does NOT cover postCard / bitable / fetch logic (those land
 * in PR-2 / PR-3 with their own test files).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safe, log, hasRequiredFeishuInputs } from '../sync.mjs';

test('safe() redacts GitHub classic PAT (ghp_ + 36 chars)', () => {
  // Exactly 36 chars after ghp_ — real GitHub classic PAT length
  const body = 'aBcD0123456789abcdefghijklmnopqrstuv'; // 4+10+22 = 36
  const input = `token ghp_${body} leaked`;
  const out = safe(input);
  assert.equal(out, 'token *** leaked');
  assert.ok(!out.includes('ghp_'));
});

test('safe() redacts GitHub fine-grained PAT (github_pat_ + 82 chars)', () => {
  const long = 'A'.repeat(82);
  const input = `Authorization: github_pat_${long}`;
  const out = safe(input);
  assert.equal(out, 'Authorization: ***');
});

test('safe() redacts GitHub OAuth / user / refresh tokens', () => {
  const oauth = 'o'.repeat(36);
  const user = 'u'.repeat(36);
  const refresh = 'r'.repeat(76);
  const input = `oauth=gho_${oauth} user=ghu_${user} refresh=ghr_${refresh}`;
  const out = safe(input);
  assert.ok(!out.includes('gho_'));
  assert.ok(!out.includes('ghu_'));
  assert.ok(!out.includes('ghr_'));
  assert.match(out, /\*\*\*/);
});

test('safe() redacts Feishu user access token (t- prefix)', () => {
  const tokenBody = 'X'.repeat(30);
  const input = `bearer t-${tokenBody} leaked`;
  const out = safe(input);
  assert.ok(!out.includes('t-' + tokenBody), `expected redaction, got: ${out}`);
  assert.match(out, /\*\*\*/);
});

test('safe() redacts Feishu tenant access token (t-g prefix)', () => {
  const tokenBody = 'Y'.repeat(30);
  const input = `X-Tenant-Token: t-g${tokenBody}`;
  const out = safe(input);
  assert.ok(!out.includes('t-g' + tokenBody));
  assert.match(out, /\*\*\*/);
});

test('safe() redacts Feishu client token (t-cl prefix)', () => {
  const tokenBody = 'Z'.repeat(30);
  const input = `client=t-cl${tokenBody} done`;
  const out = safe(input);
  assert.ok(!out.includes('t-cl' + tokenBody));
  assert.match(out, /\*\*\*/);
});

test('safe() redacts Feishu cli_ style token', () => {
  const tokenBody = 'a'.repeat(30);
  const input = `cli_${tokenBody} appeared`;
  const out = safe(input);
  assert.ok(!out.includes('cli_' + tokenBody));
  assert.match(out, /\*\*\*/);
});

test('safe() redacts 32-hex Feishu App Secret', () => {
  const hex32 = '0123456789abcdef0123456789abcdef';
  const input = `app_secret=${hex32}`;
  const out = safe(input);
  assert.ok(!out.includes(hex32), `expected redaction, got: ${out}`);
  assert.match(out, /\*\*\*/);
});

test('safe() handles uppercase hex App Secret', () => {
  const hex32 = '0123456789ABCDEF0123456789ABCDEF';
  const out = safe(`secret ${hex32}`);
  assert.ok(!out.includes(hex32));
});

test('safe() redacts generic secret_<32+> format', () => {
  const tail = 'b'.repeat(40);
  const input = `secret_${tail} in env`;
  const out = safe(input);
  assert.ok(!out.includes('secret_' + tail));
});

test('safe() handles multiple tokens in one string', () => {
  const body = 'aBcD0123456789abcdefghijklmnopqrstuv'; // 36 chars
  const input = `ghp_${body} and t-g` + 'Y'.repeat(30);
  const out = safe(input);
  assert.ok(!out.includes('ghp_'));
  assert.ok(!out.includes('t-g'));
  // Should have at least 2 *** replacements
  const stars = (out.match(/\*\*\*/g) || []).length;
  assert.ok(stars >= 2, `expected >= 2 redactions, got ${stars}: ${out}`);
});

test('safe() passes through non-string inputs unchanged', () => {
  assert.equal(safe(42), 42);
  assert.equal(safe(null), null);
  assert.equal(safe(undefined), undefined);
  const obj = { foo: 'bar' };
  assert.equal(safe(obj), obj);
});

test('safe() does not redact ordinary prose without tokens', () => {
  const input = 'this is a normal log line with no secrets';
  assert.equal(safe(input), input);
});

test('safe() handles empty string', () => {
  assert.equal(safe(''), '');
});

test('safe() works on JSON-stringified error objects containing tokens', () => {
  const body = 'aBcD0123456789abcdefghijklmnopqrstuv';
  const errObj = { message: `auth failed with token ghp_${body}`, code: 401 };
  const out = safe(JSON.stringify(errObj));
  assert.ok(!out.includes('ghp_'));
  assert.match(out, /\*\*\*/);
});

test('hasRequiredFeishuInputs() returns false when env unset', () => {
  // Note: in test env, FEISHU_APP_ID / FEISHU_APP_SECRET are not set
  // (test runner does not inherit calling process env unless explicitly configured)
  // Save and clear to be explicit.
  const savedId = process.env.FEISHU_APP_ID;
  const savedSecret = process.env.FEISHU_APP_SECRET;
  delete process.env.FEISHU_APP_ID;
  delete process.env.FEISHU_APP_SECRET;
  try {
    assert.equal(hasRequiredFeishuInputs(), false);
  } finally {
    if (savedId !== undefined) process.env.FEISHU_APP_ID = savedId;
    if (savedSecret !== undefined) process.env.FEISHU_APP_SECRET = savedSecret;
  }
});

test('hasRequiredFeishuInputs() returns true when both set', () => {
  const savedId = process.env.FEISHU_APP_ID;
  const savedSecret = process.env.FEISHU_APP_SECRET;
  process.env.FEISHU_APP_ID = 'cli_test_app';
  process.env.FEISHU_APP_SECRET = '0123456789abcdef0123456789abcdef';
  try {
    assert.equal(hasRequiredFeishuInputs(), true);
  } finally {
    if (savedId === undefined) delete process.env.FEISHU_APP_ID;
    else process.env.FEISHU_APP_ID = savedId;
    if (savedSecret === undefined) delete process.env.FEISHU_APP_SECRET;
    else process.env.FEISHU_APP_SECRET = savedSecret;
  }
});

test('log() does not throw and writes to stderr', () => {
  // Smoke test — just verify no throw. Output goes to stderr.
  const body = 'aBcD0123456789abcdefghijklmnopqrstuv';
  assert.doesNotThrow(() => log('INFO', 'test message with no secrets'));
  assert.doesNotThrow(() => log('WARN', `token ghp_${body} should be redacted`));
});
