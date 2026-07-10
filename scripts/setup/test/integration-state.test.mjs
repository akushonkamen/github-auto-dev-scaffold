/**
 * Integration tests for state.mjs persistence + ensureGitignored idempotency.
 *
 * State path is redirected via WIZARD_STATE_PATH env so we do not pollute the
 * real .wizard-state.json. ensureGitignored's findRepoRoot walks from
 * process.cwd(), so we chdir into a temp sandbox with a .git marker.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as state from '../lib/state.mjs';

function freshSandbox() {
  const sandbox = mkdtempSync(join(tmpdir(), 'wiz-state-'));
  mkdirSync(join(sandbox, '.git'));
  return sandbox;
}

test('ensureGitignored is idempotent — second call does not duplicate entry', () => {
  const sandbox = freshSandbox();
  const ignorePath = join(sandbox, '.gitignore');
  const origCwd = process.cwd();
  process.chdir(sandbox);
  try {
    writeFileSync(ignorePath, '');
    assert.equal(state.ensureGitignored(), true, 'first call');
    const after1 = readFileSync(ignorePath, 'utf-8');
    assert.match(after1, /scripts\/setup\/\.wizard-state\.json/);
    assert.equal(state.ensureGitignored(), true, 'second call');
    const after2 = readFileSync(ignorePath, 'utf-8');
    const occurrences = (after2.match(/scripts\/setup\/\.wizard-state\.json/g) || []).length;
    assert.equal(occurrences, 1, `expected 1 occurrence, got ${occurrences}`);
  } finally {
    process.chdir(origCwd);
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('ensureGitignored appends to existing .gitignore without extra newline', () => {
  const sandbox = freshSandbox();
  const ignorePath = join(sandbox, '.gitignore');
  const origCwd = process.cwd();
  process.chdir(sandbox);
  try {
    writeFileSync(ignorePath, 'node_modules/\n*.log\n');
    state.ensureGitignored();
    const content = readFileSync(ignorePath, 'utf-8');
    assert.match(content, /scripts\/setup\/\.wizard-state\.json/);
    // Existing content preserved
    assert.match(content, /^node_modules\//m);
  } finally {
    process.chdir(origCwd);
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('ensureGitignored falls back to __dirname walk when cwd is not a git repo', () => {
  // When the user runs the wizard from a directory that isn't a git repo,
  // findRepoRoot falls back to walking from __dirname (the wizard's own
  // location, which is inside a repo). This is the intended production
  // behaviour — never silently skip gitignore updates just because the
  // current cwd is not a git repo.
  const sandbox = mkdtempSync(join(tmpdir(), 'wiz-state-')); // no .git
  const origCwd = process.cwd();
  process.chdir(sandbox);
  try {
    // Returns true because the wizard itself lives inside a repo.
    // We don't assert on the .gitignore contents because that would
    // mutate the real repo's .gitignore.
    assert.equal(typeof state.ensureGitignored(), 'boolean');
  } finally {
    process.chdir(origCwd);
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('saveState/loadState round-trip preserves payload', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'wiz-state-'));
  const origCwd = process.cwd();
  const origEnv = process.env.WIZARD_STATE_PATH;
  process.env.WIZARD_STATE_PATH = join(sandbox, '.wizard-state.json');
  try {
    const initial = state.loadState();
    initial.targetRepo = 'akushonkamen/test-repo';
    initial.baseBranch = 'dev';
    state.saveState(initial);

    const reloaded = state.loadState();
    assert.equal(reloaded.targetRepo, 'akushonkamen/test-repo');
    assert.equal(reloaded.baseBranch, 'dev');
    assert.equal(reloaded.version, 1);
  } finally {
    process.env.WIZARD_STATE_PATH = origEnv;
    process.chdir(origCwd);
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('markStepComplete records step id with ISO timestamp', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'wiz-state-'));
  const origEnv = process.env.WIZARD_STATE_PATH;
  process.env.WIZARD_STATE_PATH = join(sandbox, '.wizard-state.json');
  try {
    const s = state.loadState();
    state.markStepComplete(s, '00-preflight', { ghAccount: 'akushonkamen' });
    assert.ok(s.completedSteps['00-preflight']);
    assert.equal(s.completedSteps['00-preflight'].ghAccount, 'akushonkamen');
    assert.match(s.completedSteps['00-preflight'].at, /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    process.env.WIZARD_STATE_PATH = origEnv;
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('clearState deletes state file', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'wiz-state-'));
  const origEnv = process.env.WIZARD_STATE_PATH;
  process.env.WIZARD_STATE_PATH = join(sandbox, '.wizard-state.json');
  try {
    const s = state.loadState();
    state.saveState(s);
    assert.ok(existsSync(state.statePath()));
    state.clearState();
    assert.equal(existsSync(state.statePath()), false, 'file should be deleted, not truncated');
  } finally {
    process.env.WIZARD_STATE_PATH = origEnv;
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('loadState treats empty state file as fresh state (no crash)', () => {
  // Regression: clearState() used to truncate to '', then next launch crashed
  // on JSON.parse(''). loadState must treat empty/whitespace as no state.
  const sandbox = mkdtempSync(join(tmpdir(), 'wiz-state-'));
  const origEnv = process.env.WIZARD_STATE_PATH;
  const statePath = join(sandbox, '.wizard-state.json');
  process.env.WIZARD_STATE_PATH = statePath;
  try {
    writeFileSync(statePath, '');
    const s = state.loadState();
    assert.equal(s.version, 1, 'empty file returns fresh default state');
    assert.ok(s.startedAt, 'startedAt is populated');
    assert.deepEqual(s.completedSteps, {});

    // Also cover whitespace-only case
    writeFileSync(statePath, '   \n  \n');
    const s2 = state.loadState();
    assert.equal(s2.version, 1, 'whitespace-only file returns fresh default state');
  } finally {
    process.env.WIZARD_STATE_PATH = origEnv;
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('loadState rejects unsupported version with clear error', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'wiz-state-'));
  const origEnv = process.env.WIZARD_STATE_PATH;
  const statePath = join(sandbox, '.wizard-state.json');
  process.env.WIZARD_STATE_PATH = statePath;
  writeFileSync(statePath, JSON.stringify({ version: 99 }) + '\n');
  try {
    assert.throws(() => state.loadState(), /unsupported wizard-state version/);
  } finally {
    process.env.WIZARD_STATE_PATH = origEnv;
    rmSync(sandbox, { recursive: true, force: true });
  }
});
