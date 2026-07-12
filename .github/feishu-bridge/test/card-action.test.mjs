/**
 * card-action.test.mjs — 卡片按钮 handler 单元测试
 *
 * 覆盖 PR-6 的两条卡片入口：
 *   - approve_button (tag=approve_btn)
 *   - request_changes_button (tag=request_changes_btn)
 *
 * 关键场景：
 *   1. value 合法 + owner → 调用 executePrReview 等效路径，APPROVE/REQUEST_CHANGES
 *   2. value 缺字段 → 友好错误回复，无 GitHub 调用
 *   3. parseTargetFromValue 边界
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  handleApproveButton,
  parseTargetFromValue,
  APPROVE_BTN_TAG,
} from '../card-actions/approve-button.mjs';
import {
  handleRequestChangesButton,
  REQUEST_CHANGES_BTN_TAG,
} from '../card-actions/request-changes.mjs';

function makeDeps({ files, codeownersContent, reviewCalls = [], commentCalls = [] }) {
  return {
    createOctokit: () => ({ __fake: true }),
    fetchPRFiles: async () => files,
    fetchCodeowners: async () => ({ content: codeownersContent, etag: '"x"', hit: false }),
    postReview: async (_o, _r, _p, prNumber, event) => {
      reviewCalls.push({ prNumber, event });
      return { id: 1 };
    },
    postIssueComment: async (_o, _r, _p, prNumber, body) => {
      commentCalls.push({ prNumber, body });
      return { id: 2 };
    },
  };
}

test('tags: distinct constants', () => {
  assert.equal(APPROVE_BTN_TAG, 'approve_btn');
  assert.equal(REQUEST_CHANGES_BTN_TAG, 'request_changes_btn');
  assert.notEqual(APPROVE_BTN_TAG, REQUEST_CHANGES_BTN_TAG);
});

test('parseTargetFromValue: happy path', () => {
  assert.deepEqual(
    parseTargetFromValue({ owner: 'a', repo: 'b', pr_number: 7 }),
    { owner: 'a', repo: 'b', prNumber: 7 },
  );
});

test('parseTargetFromValue: rejects missing fields', () => {
  assert.equal(parseTargetFromValue(null), null);
  assert.equal(parseTargetFromValue({}), null);
  assert.equal(parseTargetFromValue({ owner: 'a' }), null);
  assert.equal(parseTargetFromValue({ owner: 'a', repo: 'b' }), null);
});

test('parseTargetFromValue: rejects bad pr_number', () => {
  assert.equal(parseTargetFromValue({ owner: 'a', repo: 'b', pr_number: 'x' }), null);
  assert.equal(parseTargetFromValue({ owner: 'a', repo: 'b', pr_number: 0 }), null);
  assert.equal(parseTargetFromValue({ owner: 'a', repo: 'b', pr_number: -1 }), null);
});

test('handleApproveButton: owner → APPROVE review + audit comment', async () => {
  const reviewCalls = [];
  const commentCalls = [];
  const r = await handleApproveButton({
    action: {
      tag: APPROVE_BTN_TAG,
      value: { owner: 'foo', repo: 'bar', pr_number: 55, action: 'approve' },
    },
    openId: 'ou_alice',
    masterKey: Buffer.alloc(32, 1),
    lookupFn: async () => ({
      github_user: 'alice',
      pat: Buffer.from('github_pat_test_value'),
      bound_at: '2026-07-12',
    }),
    deps: makeDeps({
      files: ['src/index.js'],
      codeownersContent: '*.js  @alice\n',
      reviewCalls,
      commentCalls,
    }),
  });
  assert.match(r.reply, /approved PR #55/);
  assert.equal(reviewCalls[0].event, 'APPROVE');
  assert.match(commentCalls[0].body, /action=approved/);
});

test('handleRequestChangesButton: owner → REQUEST_CHANGES review', async () => {
  const reviewCalls = [];
  const commentCalls = [];
  const r = await handleRequestChangesButton({
    action: {
      tag: REQUEST_CHANGES_BTN_TAG,
      value: { owner: 'foo', repo: 'bar', pr_number: 55, action: 'request_changes' },
    },
    openId: 'ou_alice',
    masterKey: Buffer.alloc(32, 1),
    lookupFn: async () => ({
      github_user: 'alice',
      pat: Buffer.from('github_pat_test_value'),
      bound_at: '2026-07-12',
    }),
    deps: makeDeps({
      files: ['src/index.js'],
      codeownersContent: '*.js  @alice\n',
      reviewCalls,
      commentCalls,
    }),
  });
  assert.match(r.reply, /requested changes on PR #55/);
  assert.equal(reviewCalls[0].event, 'REQUEST_CHANGES');
  assert.match(commentCalls[0].body, /action=request_changes/);
});

test('handleApproveButton: non-owner → reject, zero side effects (S7)', async () => {
  const reviewCalls = [];
  const commentCalls = [];
  const r = await handleApproveButton({
    action: {
      tag: APPROVE_BTN_TAG,
      value: { owner: 'foo', repo: 'bar', pr_number: 55 },
    },
    openId: 'ou_eve',
    masterKey: Buffer.alloc(32, 1),
    lookupFn: async () => ({
      github_user: 'eve',
      pat: Buffer.from('github_pat_test'),
      bound_at: '2026-07-12',
    }),
    deps: makeDeps({
      files: ['src/index.js'],
      codeownersContent: '*.js  @alice\n',
      reviewCalls,
      commentCalls,
    }),
  });
  assert.match(r.reply, /Rejected/);
  assert.equal(reviewCalls.length, 0);
  assert.equal(commentCalls.length, 0);
});

test('handleApproveButton: malformed value → error reply, zero side effects', async () => {
  const reviewCalls = [];
  const r = await handleApproveButton({
    action: { tag: APPROVE_BTN_TAG, value: { owner: 'foo' } }, // missing repo+pr_number
    openId: 'ou_x',
    masterKey: Buffer.alloc(32, 1),
    lookupFn: async () => null,
    deps: makeDeps({ files: [], codeownersContent: '', reviewCalls }),
  });
  assert.match(r.reply, /missing PR target/i);
  assert.equal(reviewCalls.length, 0);
});

test('handleApproveButton: not bound → friendly reply, zero side effects', async () => {
  const reviewCalls = [];
  const r = await handleApproveButton({
    action: {
      tag: APPROVE_BTN_TAG,
      value: { owner: 'foo', repo: 'bar', pr_number: 1 },
    },
    openId: 'ou_x',
    masterKey: Buffer.alloc(32, 1),
    lookupFn: async () => null,
    deps: makeDeps({ files: ['a.js'], codeownersContent: '* @x', reviewCalls }),
  });
  assert.match(r.reply, /Not bound/);
  assert.equal(reviewCalls.length, 0);
});
