import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isForbiddenBaseBranch,
  maskSecret,
  validateBranchName,
  validateHttpUrl,
  validateModelId,
  validateNotionDatabaseId,
  validateNotionKey,
  validatePAT,
  validatePositiveInt,
  validateRepo,
  validateTeamSlug,
} from '../lib/validators.mjs';

test('validateRepo', () => {
  assert.equal(validateRepo('owner/name').ok, true);
  assert.equal(validateRepo('akushonkamen/my-repo').value, 'akushonkamen/my-repo');
  assert.equal(validateRepo('').ok, false);
  assert.equal(validateRepo('owner').ok, false);
  assert.equal(validateRepo('a/b/c').ok, false);
  assert.equal(validateRepo('.hidden/name').ok, false);
});

test('validateBranchName', () => {
  assert.equal(validateBranchName('dev').ok, true);
  assert.equal(validateBranchName('feature/foo-bar').value, 'feature/foo-bar');
  assert.equal(validateBranchName('refs/heads/main').ok, false);
  assert.equal(validateBranchName('main~1').ok, false);
  assert.equal(validateBranchName('a..b').ok, false);
  assert.equal(validateBranchName('-leading').ok, false);
  assert.equal(validateBranchName('with space').ok, false);
});

test('isForbiddenBaseBranch', () => {
  assert.equal(isForbiddenBaseBranch('main'), true);
  assert.equal(isForbiddenBaseBranch('master'), true);
  assert.equal(isForbiddenBaseBranch('dev'), false);
});

test('validateHttpUrl', () => {
  assert.equal(validateHttpUrl('https://open.bigmodel.cn').ok, true);
  assert.equal(validateHttpUrl('https://open.bigmodel.cn/').value, 'https://open.bigmodel.cn');
  assert.equal(validateHttpUrl('ftp://x').ok, false);
  assert.equal(validateHttpUrl('not-a-url').ok, false);
  assert.equal(validateHttpUrl('', { allowEmpty: true }).ok, true);
});

test('validateModelId', () => {
  assert.equal(validateModelId('glm-5.2').ok, true);
  assert.equal(validateModelId('claude-opus-4-7').value, 'claude-opus-4-7');
  assert.equal(validateModelId('with space').ok, false);
  assert.equal(validateModelId('').ok, false);
});

test('validatePAT', () => {
  assert.equal(validatePAT('github_pat_longenoughvalue').ok, true);
  assert.equal(validatePAT('github_pat_longenoughvalue').kind, 'fine-grained');
  assert.equal(validatePAT('ghp_abc123').ok, false);
  assert.equal(validatePAT('gho_abc').ok, false);
  assert.equal(validatePAT('short').ok, false);
  assert.equal(validatePAT('').ok, false);
  assert.equal(validatePAT('github_pat_short').ok, false); // <20 chars
});

test('validateNotionKey', () => {
  assert.equal(validateNotionKey('secret_abc123').ok, true);
  assert.equal(validateNotionKey('ntn_abc123').ok, true);
  assert.equal(validateNotionKey('bad').ok, false);
});

test('validateNotionDatabaseId', () => {
  const id = 'a'.repeat(32);
  assert.equal(validateNotionDatabaseId(id).ok, true);
  const dashed = `${'a'.repeat(8)}-${'b'.repeat(4)}-${'c'.repeat(4)}-${'d'.repeat(4)}-${'e'.repeat(12)}`;
  assert.equal(validateNotionDatabaseId(dashed).ok, true);
  assert.equal(validateNotionDatabaseId('xyz').ok, false);
});

test('validateTeamSlug', () => {
  assert.equal(validateTeamSlug('org/team').ok, true);
  assert.equal(validateTeamSlug('@org/team').value, 'org/team');
  assert.equal(validateTeamSlug('login').ok, true);
  assert.equal(validateTeamSlug('@login').value, 'login');
  assert.equal(validateTeamSlug('').ok, false);
  assert.equal(validateTeamSlug('bad/slug/extra').ok, false);
});

test('validatePositiveInt', () => {
  assert.equal(validatePositiveInt('20').value, 20);
  assert.equal(validatePositiveInt('0').ok, false);
  assert.equal(validatePositiveInt('-1').ok, false);
  assert.equal(validatePositiveInt('abc').ok, false);
  assert.equal(validatePositiveInt('99999').ok, false);
});

test('maskSecret', () => {
  assert.equal(maskSecret('github_pat_abcdefgh1234567890'), 'github_pat_…7890');
  assert.equal(maskSecret('short'), '***');
  assert.equal(maskSecret(''), '***');
});
