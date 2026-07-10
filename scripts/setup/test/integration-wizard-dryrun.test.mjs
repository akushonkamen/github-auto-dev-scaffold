/**
 * Integration test: spawn `node wizard.mjs --dry-run --no-state` as a
 * subprocess, close stdin immediately, and verify:
 *   (a) stdout contains the wizard banner + at least Step 0 + Step 1 titles
 *   (b) process exits non-zero (Step 2 throws when inquirer prompt gets EOF)
 *
 * This is a smoke test of the orchestration layer — module loading, banner
 * rendering, step iteration. It is NOT a test of step-internal logic.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

test('wizard.mjs --dry-run --no-state: prints banner, runs preflight, exits non-zero on stdin close', async () => {
  const wizardPath = join(process.cwd(), 'wizard.mjs');
  const child = spawn('node', [wizardPath, '--dry-run', '--no-state', '--from-step=0'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => (stdout += d.toString()));
  child.stderr.on('data', (d) => (stderr += d.toString()));

  // Close stdin immediately so inquirer prompts fail fast.
  child.stdin.end();

  const code = await new Promise((resolve) => child.on('close', resolve));

  // Strip ANSI codes for assertions
  const stripped = stdout.replace(/\x1b\[[0-9;]*m/g, '');

  assert.match(stripped, /Setup wizard — DRY-RUN mode/, 'banner rendered');
  assert.match(stripped, /\[step 1\/12\] Pre-flight checks/, 'Step 0 banner shown');
  assert.match(stripped, /\[step 2\/12\] Target repo connection/, 'Step 1 banner shown');
  assert.match(stripped, /Setup wizard — summary/, 'summary rendered');
  assert.notEqual(code, 0, 'non-zero exit expected when inquirer prompts hit EOF');
});
