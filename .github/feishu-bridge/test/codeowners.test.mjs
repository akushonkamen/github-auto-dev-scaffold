/**
 * codeowners.test.mjs — 5 glob 模式 + ETag invalidate 单元测试
 *
 * 覆盖 PR-5 AC：
 *   - 5 种 glob 模式：root anchor / dir-trailing-slash / wildcard * /
 *     globstar ** / negation !
 *   - ETag invalidate 通过 fetchCodeownersETag 行为单独覆盖（在 approve.test.mjs）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCodeowners, getOwners, isOwnerOfAnyFile } from '../codeowners-lib.mjs';

const FIXTURE = `# sample CODEOWNERS
*                           @global-owner
src/                        @src-team
*.js                        @js-team
/src/docs/**                @docs-team
!src/docs/legacy/**         @docs-team
`;

test('parseCodeowners skips blank lines + comments', () => {
  const entries = parseCodeowners('# header\n\n*.ts  @ts\n# trailing\n');
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].owners, ['@ts']);
});

test('glob 1: trailing-slash directory matches descendants', () => {
  const entries = parseCodeowners('src/   @src-team\n');
  assert.deepEqual(getOwners('src/foo.ts', entries), ['@src-team']);
  assert.deepEqual(getOwners('src/nested/bar.js', entries), ['@src-team']);
  assert.deepEqual(getOwners('test/foo.ts', entries), []);
});

test('glob 2: extension wildcard matches across tree', () => {
  const entries = parseCodeowners('*.js   @js-team\n');
  assert.deepEqual(getOwners('foo.js', entries), ['@js-team']);
  assert.deepEqual(getOwners('a/b/c/foo.js', entries), ['@js-team']);
  assert.deepEqual(getOwners('foo.ts', entries), []);
});

test('glob 3: globstar ** matches nested path', () => {
  const entries = parseCodeowners('/src/docs/**   @docs-team\n');
  assert.deepEqual(getOwners('src/docs/index.md', entries), ['@docs-team']);
  assert.deepEqual(getOwners('src/docs/nested/deep.md', entries), ['@docs-team']);
  assert.deepEqual(getOwners('src/other.md', entries), []);
});

test('glob 4: last match wins (precedence)', () => {
  const entries = parseCodeowners(FIXTURE);
  // FIXTURE order: * / src/ / *.js / /src/docs/** / !src/docs/legacy/**
  // For src/foo.js: *.js is later than src/ → @js-team wins
  assert.deepEqual(getOwners('src/foo.js', entries), ['@js-team']);
  // *.js catches test/bar.js → @js-team
  assert.deepEqual(getOwners('test/bar.js', entries), ['@js-team']);
  // README.md matches only * → @global-owner
  assert.deepEqual(getOwners('README.md', entries), ['@global-owner']);
});

test('glob 5: negation excludes otherwise-matching path', () => {
  const entries = parseCodeowners(FIXTURE);
  // src/docs/** matches src/docs/legacy/x.md, but !src/docs/legacy/** (later) wins
  // → path is negated → returns [] (no owner), does NOT fall back to *
  assert.deepEqual(getOwners('src/docs/legacy/x.md', entries), []);
  // src/docs/index.md → @docs-team (negation pattern doesn't match this path)
  assert.deepEqual(getOwners('src/docs/index.md', entries), ['@docs-team']);
});

test('isOwnerOfAnyFile: case-insensitive + @ prefix normalization', () => {
  const entries = parseCodeowners('*.ts   @Alice\n');
  assert.equal(isOwnerOfAnyFile(['a.ts'], 'alice', entries), true);
  assert.equal(isOwnerOfAnyFile(['a.ts'], '@alice', entries), true);
  assert.equal(isOwnerOfAnyFile(['a.ts'], 'ALICE', entries), true);
  assert.equal(isOwnerOfAnyFile(['a.ts'], 'bob', entries), false);
});

test('isOwnerOfAnyFile: union across multiple files', () => {
  const entries = parseCodeowners('*.ts   @ts-team\n*.go   @go-team\n');
  assert.equal(isOwnerOfAnyFile(['a.ts', 'b.go'], 'ts-team', entries), true);
  assert.equal(isOwnerOfAnyFile(['a.ts', 'b.go'], 'go-team', entries), true);
  assert.equal(isOwnerOfAnyFile(['a.ts', 'b.go'], 'rust-team', entries), false);
});

test('isOwnerOfAnyFile: empty file list → false', () => {
  const entries = parseCodeowners('*.ts   @ts-team\n');
  assert.equal(isOwnerOfAnyFile([], 'ts-team', entries), false);
});

test('getOwners: empty path → empty array', () => {
  const entries = parseCodeowners('*.ts   @ts-team\n');
  assert.deepEqual(getOwners('', entries), []);
});
