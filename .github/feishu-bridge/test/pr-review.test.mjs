/**
 * pr-review.test.mjs — actions/pr-review.mjs 共享 review 执行逻辑单元测试
 *
 * 覆盖 PR-6 共享模块的两条入口（/approve + 卡片按钮）共享的执行路径：
 *   - APPROVE event
 *   - REQUEST_CHANGES event
 *   - 非 owner 拒绝（零副作用）
 *   - 未绑定 → 友好回复
 *   - 空 PR → 拒绝
 *   - target 校验 + event 校验
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executePrReview, hashOpenIdForAudit } from '../actions/pr-review.mjs';

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

const TARGET = { owner: 'foo', repo: 'bar', prNumber: 55 };

test('executePrReview: APPROVE → posts APPROVE review + audit + success reply', async () => {
  const reviewCalls = [];
  const commentCalls = [];
  const r = await executePrReview({
    openId: 'ou_alice',
    target: TARGET,
    masterKey: Buffer.alloc(32, 1),
    lookupFn: async () => ({
      github_user: 'alice',
      pat: Buffer.from('github_pat_test_value_for_unit_test_only'),
      bound_at: '2026-07-12T00:00:00Z',
    }),
    deps: makeDeps({
      files: ['src/index.js'],
      codeownersContent: '*.js  @alice\n',
      reviewCalls,
      commentCalls,
    }),
    event: 'APPROVE',
  });
  assert.match(r.reply, /approved PR #55/);
  assert.match(r.reply, /@alice/);
  assert.equal(reviewCalls.length, 1);
  assert.equal(reviewCalls[0].event, 'APPROVE');
  assert.equal(commentCalls.length, 1);
  assert.match(commentCalls[0].body, /action=approved/);
  assert.match(commentCalls[0].body, /feishu_user_hash=[0-9a-f]{12}/);
  assert.doesNotMatch(commentCalls[0].body, /ou_alice/);
});

test('executePrReview: REQUEST_CHANGES → posts REQUEST_CHANGES review', async () => {
  const reviewCalls = [];
  const commentCalls = [];
  const r = await executePrReview({
    openId: 'ou_alice',
    target: TARGET,
    masterKey: Buffer.alloc(32, 1),
    lookupFn: async () => ({
      github_user: 'alice',
      pat: Buffer.from('github_pat_test_value_for_unit_test_only'),
      bound_at: '2026-07-12',
    }),
    deps: makeDeps({
      files: ['src/x.js'],
      codeownersContent: '*.js  @alice\n',
      reviewCalls,
      commentCalls,
    }),
    event: 'REQUEST_CHANGES',
  });
  assert.match(r.reply, /requested changes on PR #55/);
  assert.equal(reviewCalls[0].event, 'REQUEST_CHANGES');
  assert.match(commentCalls[0].body, /action=request_changes/);
});

test('executePrReview: NON-OWNER → zero side effects', async () => {
  const reviewCalls = [];
  const commentCalls = [];
  const r = await executePrReview({
    openId: 'ou_eve',
    target: TARGET,
    masterKey: Buffer.alloc(32, 1),
    lookupFn: async () => ({
      github_user: 'eve',
      pat: Buffer.from('github_pat_test'),
      bound_at: '2026-07-12',
    }),
    deps: makeDeps({
      files: ['src/x.js'],
      codeownersContent: '*.js  @alice\n',
      reviewCalls,
      commentCalls,
    }),
    event: 'APPROVE',
  });
  assert.match(r.reply, /Rejected/);
  assert.match(r.reply, /CODEOWNER/);
  assert.equal(reviewCalls.length, 0);
  assert.equal(commentCalls.length, 0);
});

test('executePrReview: not bound → friendly reply, no GitHub calls', async () => {
  const reviewCalls = [];
  const r = await executePrReview({
    openId: 'ou_x',
    target: TARGET,
    masterKey: Buffer.alloc(32, 1),
    lookupFn: async () => null,
    deps: makeDeps({ files: ['a.js'], codeownersContent: '* @x', reviewCalls }),
    event: 'APPROVE',
  });
  assert.match(r.reply, /Not bound/);
  assert.equal(reviewCalls.length, 0);
});

test('executePrReview: empty PR → reject with reason', async () => {
  const r = await executePrReview({
    openId: 'ou_x',
    target: TARGET,
    masterKey: Buffer.alloc(32, 1),
    lookupFn: async () => ({
      github_user: 'alice', pat: Buffer.from('github_pat_test'), bound_at: '2026-07-12',
    }),
    deps: makeDeps({ files: [], codeownersContent: '* @alice' }),
    event: 'APPROVE',
  });
  assert.match(r.reply, /no changed files/);
});

test('executePrReview: invalid event throws', async () => {
  await assert.rejects(
    () => executePrReview({
      openId: 'ou_x',
      target: TARGET,
      masterKey: Buffer.alloc(32, 1),
      lookupFn: async () => null,
      deps: makeDeps({ files: [], codeownersContent: '' }),
      event: 'COMMENT',
    }),
    /unsupported review event/,
  );
});

test('executePrReview: target validation', async () => {
  await assert.rejects(
    () => executePrReview({
      openId: 'ou_x',
      target: { owner: 'a' },
      masterKey: Buffer.alloc(32, 1),
      lookupFn: async () => null,
      deps: makeDeps({ files: [], codeownersContent: '' }),
    }),
    /target/i,
  );
});

test('hashOpenIdForAudit: stable, 12 hex chars, no raw open_id', () => {
  const h = hashOpenIdForAudit('ou_abc');
  assert.match(h, /^[0-9a-f]{12}$/);
  assert.equal(h, hashOpenIdForAudit('ou_abc'));
});
