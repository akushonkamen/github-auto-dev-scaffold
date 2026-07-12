/**
 * approve.test.mjs — PR-5 /approve handler 单元测试
 *
 * 3 AC 场景：
 *   1. owner 场景 → APPROVE review posted + audit comment posted + 飞书 success reply
 *   2. non-owner 场景 → NO review + NO comment + 飞书 reject reply（S7 红线）
 *   3. glob 边界（owner of one file in multi-file PR） → APPROVE
 *
 * ETag invalidate 行为通过 fetchCodeownersWithEtag 直接覆盖。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseApproveArg,
  hashOpenIdForAudit,
  fetchCodeownersWithEtag,
  handleApprove,
} from '../commands/approve.mjs';

// ---------------------------------------------------------------------------
// parseApproveArg
// ---------------------------------------------------------------------------

test('parseApproveArg: PR URL → owner/repo/number', () => {
  const r = parseApproveArg('https://github.com/foo/bar/pull/123', null);
  assert.deepEqual(r, { owner: 'foo', repo: 'bar', prNumber: 123 });
});

test('parseApproveArg: PR URL with query/anchor stripped', () => {
  const r = parseApproveArg('https://github.com/foo/bar/pull/42/files', null);
  assert.deepEqual(r, { owner: 'foo', repo: 'bar', prNumber: 42 });
});

test('parseApproveArg: bare number falls back to FEISHU_BIND_REPO', () => {
  const r = parseApproveArg('42', 'akushonkamen/scaffold');
  assert.deepEqual(r, { owner: 'akushonkamen', repo: 'scaffold', prNumber: 42 });
});

test('parseApproveArg: #N also accepted', () => {
  const r = parseApproveArg('#7', 'a/b');
  assert.deepEqual(r, { owner: 'a', repo: 'b', prNumber: 7 });
});

test('parseApproveArg: bare number without default repo → throws', () => {
  assert.throws(() => parseApproveArg('42', null), /repo not configured/);
});

test('parseApproveArg: malformed default repo → throws', () => {
  assert.throws(() => parseApproveArg('42', 'invalid'), /invalid FEISHU_BIND_REPO/);
});

test('parseApproveArg: garbage arg → throws', () => {
  assert.throws(() => parseApproveArg('not-a-url-or-num', 'a/b'), /could not parse/);
});

test('parseApproveArg: missing arg → throws', () => {
  assert.throws(() => parseApproveArg(undefined, 'a/b'), /missing argument/);
});

// ---------------------------------------------------------------------------
// hashOpenIdForAudit
// ---------------------------------------------------------------------------

test('hashOpenIdForAudit: 12 hex chars, stable, no raw open_id leakage', () => {
  const h = hashOpenIdForAudit('ou_abc123');
  assert.match(h, /^[0-9a-f]{12}$/);
  assert.equal(h, hashOpenIdForAudit('ou_abc123'));
  assert.notEqual(h, hashOpenIdForAudit('ou_other'));
});

// ---------------------------------------------------------------------------
// fetchCodeownersWithEtag
// ---------------------------------------------------------------------------

test('fetchCodeownersWithEtag: 304 reuses cached content', async () => {
  const fakeOctokit = {
    request: async () => ({ status: 304, headers: { etag: '"old"' }, data: {} }),
  };
  const r = await fetchCodeownersWithEtag({
    octokit: fakeOctokit,
    owner: 'a',
    repo: 'b',
    path: '.github/CODEOWNERS',
    cache: { etag: '"old"', content: '* @someone' },
  });
  assert.equal(r.hit, true);
  assert.equal(r.content, '* @someone');
});

test('fetchCodeownersWithEtag: 200 returns new content + new etag', async () => {
  const fakeOctokit = {
    request: async () => ({
      status: 200,
      headers: { etag: '"new"' },
      data: { content: Buffer.from('* @new').toString('base64') },
    }),
  };
  const r = await fetchCodeownersWithEtag({
    octokit: fakeOctokit,
    owner: 'a',
    repo: 'b',
    path: '.github/CODEOWNERS',
    cache: null,
  });
  assert.equal(r.hit, false);
  assert.equal(r.content, '* @new');
  assert.equal(r.etag, '"new"');
});

test('fetchCodeownersWithEtag: 304 with no cache → throws (defense)', async () => {
  const fakeOctokit = { request: async () => ({ status: 304, data: {} }) };
  await assert.rejects(
    () => fetchCodeownersWithEtag({
      octokit: fakeOctokit, owner: 'a', repo: 'b', path: 'p', cache: null,
    }),
    /no local cache/,
  );
});

test('fetchCodeownersWithEtag: sends If-None-Match header when cache present', async () => {
  let sentHeaders = null;
  const fakeOctokit = {
    request: async (_path, opts) => {
      sentHeaders = opts.headers;
      return { status: 200, headers: {}, data: { content: '' } };
    },
  };
  await fetchCodeownersWithEtag({
    octokit: fakeOctokit,
    owner: 'a',
    repo: 'b',
    path: 'p',
    cache: { etag: '"abc"', content: 'old' },
  });
  assert.equal(sentHeaders['If-None-Match'], '"abc"');
});

// ---------------------------------------------------------------------------
// handleApprove — 3 main scenarios
// ---------------------------------------------------------------------------

function makeDeps({ files, codeownersContent, reviewCalls = [], commentCalls = [] }) {
  return {
    createOctokit: () => ({ __fake: true }),
    fetchPRFiles: async () => files,
    fetchCodeowners: async () => ({ content: codeownersContent, etag: '"x"', hit: false }),
    postReview: async (_octokit, _o, _r, prNumber, event) => {
      reviewCalls.push({ prNumber, event });
      return { id: 1 };
    },
    postIssueComment: async (_octokit, _o, _r, prNumber, body) => {
      commentCalls.push({ prNumber, body });
      return { id: 2 };
    },
  };
}

test('handleApprove: OWNER → posts APPROVE review + audit comment + success reply', async () => {
  const reviewCalls = [];
  const commentCalls = [];
  const r = await handleApprove({
    openId: 'ou_alice',
    args: ['https://github.com/foo/bar/pull/55'],
    masterKey: Buffer.alloc(32, 1),
    bindRepo: 'foo/bar',
    lookupFn: async () => ({
      github_user: 'alice',
      pat: Buffer.from('github_pat_test_value_for_unit_test_only'),
      bound_at: '2026-07-12T00:00:00Z',
    }),
    deps: makeDeps({
      files: ['src/index.js', 'README.md'],
      codeownersContent: '*.js  @alice\nREADME.md  @bob\n',
      reviewCalls,
      commentCalls,
    }),
  });

  assert.match(r.reply, /approved PR #55/);
  assert.match(r.reply, /@alice/);
  assert.equal(reviewCalls.length, 1);
  assert.equal(reviewCalls[0].event, 'APPROVE');
  assert.equal(commentCalls.length, 1);
  // Audit comment must contain hash, NOT raw open_id
  assert.match(commentCalls[0].body, /feishu_user_hash=[0-9a-f]{12}/);
  assert.doesNotMatch(commentCalls[0].body, /ou_alice/);
  assert.match(commentCalls[0].body, /by=@alice/);
});

test('handleApprove: NON-OWNER → NO review + NO comment + reject reply', async () => {
  const reviewCalls = [];
  const commentCalls = [];
  const r = await handleApprove({
    openId: 'ou_eve',
    args: ['55'],
    masterKey: Buffer.alloc(32, 1),
    bindRepo: 'foo/bar',
    lookupFn: async () => ({
      github_user: 'eve',
      pat: Buffer.from('github_pat_test_value_for_unit_test_only'),
      bound_at: '2026-07-12T00:00:00Z',
    }),
    deps: makeDeps({
      files: ['src/index.js', 'src/other.js'],
      codeownersContent: '*.js  @alice\n',  // eve is NOT listed
      reviewCalls,
      commentCalls,
    }),
  });

  assert.match(r.reply, /Rejected/);
  assert.match(r.reply, /@eve/);
  assert.match(r.reply, /CODEOWNER/);
  assert.match(r.reply, /S7/);
  // S7 red line: ZERO GitHub side effects
  assert.equal(reviewCalls.length, 0);
  assert.equal(commentCalls.length, 0);
});

test('handleApprove: glob edge — owner of one file in multi-file PR approves', async () => {
  const reviewCalls = [];
  const commentCalls = [];
  const r = await handleApprove({
    openId: 'ou_carol',
    args: ['99'],
    masterKey: Buffer.alloc(32, 1),
    bindRepo: 'foo/bar',
    lookupFn: async () => ({
      github_user: 'carol',
      pat: Buffer.from('github_pat_test_value_for_unit_test_only'),
      bound_at: '2026-07-12T00:00:00Z',
    }),
    deps: makeDeps({
      // PR touches 3 files; carol only owns the docs/ ones via /docs/** rule
      files: ['src/index.js', 'docs/intro.md', 'docs/api.md'],
      codeownersContent: 'src/   @alice\ndocs/   @carol\n',
      reviewCalls,
      commentCalls,
    }),
  });
  assert.match(r.reply, /approved PR #99/);
  assert.equal(reviewCalls.length, 1);
  assert.equal(commentCalls.length, 1);
});

test('handleApprove: not bound → reject reply, no GitHub calls', async () => {
  const reviewCalls = [];
  const commentCalls = [];
  const r = await handleApprove({
    openId: 'ou_x',
    args: ['1'],
    masterKey: Buffer.alloc(32, 1),
    bindRepo: 'foo/bar',
    lookupFn: async () => null,
    deps: makeDeps({
      files: ['a.js'],
      codeownersContent: '* @someone',
      reviewCalls,
      commentCalls,
    }),
  });
  assert.match(r.reply, /Not bound/);
  assert.equal(reviewCalls.length, 0);
  assert.equal(commentCalls.length, 0);
});

test('handleApprove: empty PR → reject with reason, no review', async () => {
  const reviewCalls = [];
  const commentCalls = [];
  const r = await handleApprove({
    openId: 'ou_x',
    args: ['1'],
    masterKey: Buffer.alloc(32, 1),
    bindRepo: 'foo/bar',
    lookupFn: async () => ({
      github_user: 'alice',
      pat: Buffer.from('github_pat_test'),
      bound_at: '2026-07-12',
    }),
    deps: makeDeps({
      files: [],
      codeownersContent: '* @alice',
      reviewCalls,
      commentCalls,
    }),
  });
  assert.match(r.reply, /no changed files/);
  assert.equal(reviewCalls.length, 0);
  assert.equal(commentCalls.length, 0);
});

test('handleApprove: missing masterKey → throws', async () => {
  await assert.rejects(
    () => handleApprove({
      openId: 'ou_x', args: ['1'], masterKey: null,
      lookupFn: async () => null, bindRepo: 'a/b', deps: makeDeps({ files: [], codeownersContent: '' }),
    }),
    /masterKey required/,
  );
});
