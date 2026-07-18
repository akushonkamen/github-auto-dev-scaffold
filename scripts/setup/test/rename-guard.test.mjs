/**
 * rename-guard.test.mjs — grep-guard for the engine-secret rename to
 * LLM_API_KEY (Issue #141).
 *
 * Turns AC1/AC2/AC3 into machine-verifiable invariants so a future change
 * cannot silently regress the rename. Runs under `node --test` with NO
 * `npm install`: pure fs walk + Buffer.includes + a dynamic import of the
 * wizard's PRESETS.
 *
 * Self-reference note: AC1 scans the whole repo, INCLUDING this file, for the
 * old secret name. The old name is therefore assembled at runtime via
 * OLD_KEY below (array join) so its contiguous literal never appears in this
 * source — otherwise the guard would match itself and always fail. The same
 * trick keeps the JSDoc and assertion messages free of the literal.
 *
 * Why a dynamic import of 03-llm-provider.mjs is safe without the optional
 * prompt dependency installed: lib/prompts.mjs is a lazy loader that defers
 * its load to the first prompt call, so merely importing a step module never
 * touches it.
 *
 * Scope note (why Issue #141 touches 03-llm-provider.mjs + adds
 * lib/prompts.mjs, and ONLY those): the issue mandates THIS test run under
 * `node --test` WITHOUT `npm install`. AC3 dynamically imports
 * 03-llm-provider.mjs, so that single module must not eagerly load
 * '@inquirer/prompts' — with no node_modules a top-level import would throw
 * ERR_MODULE_NOT_FOUND and fail AC3 before any assertion runs. 03 therefore
 * routes through the lazy lib/prompts.mjs shim, which defers the load to the
 * first prompt call. No other step module is imported by this test, so none of
 * them need touching: the rest of the wizard suite runs under `npm ci` (deps
 * present), where a direct '@inquirer/prompts' import is fine. Editing the
 * other steps or wizard.mjs would be drive-by and is deliberately avoided.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// The retired secret name, assembled so its literal never appears in source.
const OLD_KEY = ['DEEPSEEK', 'API_KEY'].join('_');
const OLD_MODEL = ['deepseek-v4', 'pro'].join('-');
const OLD_HOST = ['api.deepseek', 'com'].join('.');

const HERE = fileURLToPath(new URL('.', import.meta.url));

// Walk up from this test file to the repo root (the dir holding CLAUDE.md).
function resolveRepoRoot(start) {
  let dir = start;
  for (let i = 0; i < 12; i++) {
    try {
      if (statSync(join(dir, 'CLAUDE.md')).isFile()) return dir;
    } catch {
      // not here — keep walking up
    }
    const parent = join(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

const REPO_ROOT = resolveRepoRoot(HERE);
const SCRIPTS_ROOT = join(REPO_ROOT, 'scripts');

// Dirs excluded from the repo-wide walk (Issue #141 AC1 excludes).
const EXCLUDE_DIRS = new Set(['.git', 'node_modules', '.next', '.omc']);

function walk(root) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return out; // unreadable dir — skip
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (EXCLUDE_DIRS.has(e.name)) continue;
      out.push(...walk(join(root, e.name)));
    } else if (e.isFile()) {
      out.push(join(root, e.name));
    }
  }
  return out;
}

// Byte-substring scan (ASCII needle → exact match, binary-safe, no utf8 decode).
function findOccurrences(root, needle) {
  const hits = [];
  for (const path of walk(root)) {
    let buf;
    try {
      buf = readFileSync(path);
    } catch {
      continue; // unreadable / broken symlink — skip
    }
    if (buf.includes(needle)) {
      hits.push(relative(REPO_ROOT, path));
    }
  }
  return hits;
}

test('AC1 — no plain-text file contains the retired engine-secret name (repo-wide, excl .git/node_modules/.next/.omc)', () => {
  const hits = findOccurrences(REPO_ROOT, OLD_KEY);
  assert.deepEqual(hits, [], `stale retired-secret references remain: ${hits.join(', ')}`);
});

test('AC2 — scripts/ has no stale DeepSeek model id or api host defaults', () => {
  const modelHits = findOccurrences(SCRIPTS_ROOT, OLD_MODEL);
  const urlHits = findOccurrences(SCRIPTS_ROOT, OLD_HOST);
  assert.deepEqual(modelHits, [], `stale model id in scripts/: ${modelHits.join(', ')}`);
  assert.deepEqual(urlHits, [], `stale api host in scripts/: ${urlHits.join(', ')}`);
});

test('AC3 — GLM preset uses the provider-neutral LLM_API_KEY secret + glm-5.2 + Zhipu endpoint', async () => {
  const { PRESETS } = await import('../lib/steps/03-llm-provider.mjs');
  assert.ok(PRESETS, 'PRESETS not exported from 03-llm-provider.mjs');
  assert.ok(PRESETS.glm, 'PRESETS.glm missing');
  assert.equal(PRESETS.glm.keyEnv, 'LLM_API_KEY');
  assert.equal(PRESETS.glm.model, 'glm-5.2');
  assert.equal(PRESETS.glm.baseUrl, 'https://open.bigmodel.cn/api/anthropic');
});

test('AC3 (continued) — no preset uses the engine-specific ZHIPU_API_KEY name', async () => {
  const { PRESETS } = await import('../lib/steps/03-llm-provider.mjs');
  const offenders = Object.entries(PRESETS)
    .filter(([, v]) => v && v.keyEnv === 'ZHIPU_API_KEY')
    .map(([k]) => k);
  assert.deepEqual(offenders, [], `preset(s) still using ZHIPU_API_KEY: ${offenders.join(', ')}`);
});
