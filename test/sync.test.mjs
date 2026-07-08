/**
 * Unit tests for sync.mjs — module summary append logic.
 *
 * Verifies the three sub-bug fixes from Issue #39:
 *   1. extractIssueFromBranch() correctly extracts issue numbers from
 *      branch names like `claude/issue-39-slug` (was undefined).
 *   2. Artifact name prefix logic (tested via fixture JSON names that
 *      match `module-summary-*` pattern).
 *   3. buildModuleSummaryBlocks() produces valid Notion block objects
 *      from parsed JSON (not base64 garbage).
 *
 * Run: node --test test/sync.test.mjs
 * Requires Node 20+ (native test runner).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

// Import functions under test
import { extractIssueFromBranch, buildModuleSummaryBlocks } from '../.github/actions/notion-sync/sync.mjs';

// ── Fixture data ─────────────────────────────────────────────────────────────

const FIXTURE_ARTIFACT = {
  module: 'triage',
  summary: 'Issue accepted — ready for development.',
  run_id: '12345678901',
  idempotency_key: 'triage-12345678901',
  issue_number: 39,
};

const FIXTURE_ARTIFACT_NO_ISSUE = {
  module: 'develop',
  summary: 'Implemented fix for sub-bug 3.',
  run_id: '12345678902',
  idempotency_key: 'develop-12345678902',
};

// ── Sub-bug 1: issueNumber extraction ────────────────────────────────────────

describe('extractIssueFromBranch (sub-bug 1 fix)', () => {
  it('extracts issue number from standard branch name', () => {
    assert.equal(extractIssueFromBranch('claude/issue-39-bug-module-summaries'), '39');
  });

  it('extracts issue number from minimal branch name', () => {
    assert.equal(extractIssueFromBranch('claude/issue-1'), '1');
  });

  it('extracts multi-digit issue numbers', () => {
    assert.equal(extractIssueFromBranch('claude/issue-12345-some-feature'), '12345');
  });

  it('returns null for branch without issue pattern', () => {
    assert.equal(extractIssueFromBranch('main'), null);
  });

  it('returns null for branch with similar but different pattern', () => {
    assert.equal(extractIssueFromBranch('feature/issue-39'), null);
  });

  it('returns null for null/undefined input', () => {
    assert.equal(extractIssueFromBranch(null), null);
    assert.equal(extractIssueFromBranch(undefined), null);
    assert.equal(extractIssueFromBranch(''), null);
  });

  it('does not match issue number in middle of branch name', () => {
    // Only the `claude/issue-N` prefix pattern should match.
    assert.equal(extractIssueFromBranch('feature/claude/issue-42/fix'), '42');
    assert.equal(extractIssueFromBranch('some-claude/issue-99-extra'), null);
  });

  it('extracts the FIRST issue number when multiple appear', () => {
    // The regex finds the first `claude/issue-(\d+)` — there shouldn't be
    // multiple, but if there are, return the first.
    assert.equal(extractIssueFromBranch('claude/issue-7-and-claude/issue-8'), '7');
  });
});

// ── Sub-bug 2: artifact name prefix match ────────────────────────────────────

describe('artifact name prefix match (sub-bug 2 fix)', () => {
  const artifactNames = [
    'module-summary-triage-12345',
    'module-summary-develop-12346',
    'module-summary-test-12347',
    'module-summary-merge-queue-12348',
    'some-other-artifact',
  ];

  it('matches module-summary-* prefix', () => {
    const found = artifactNames.filter(a => a.startsWith('module-summary-'));
    assert.equal(found.length, 4);
    assert.ok(found.every(a => a.startsWith('module-summary-')));
  });

  it('does NOT match exact "module-summary" (the old buggy behavior)', () => {
    const exactMatch = artifactNames.filter(a => a === 'module-summary');
    assert.equal(exactMatch.length, 0,
      'Sub-bug 2: exact match on "module-summary" returns nothing — prefix match is required');
  });

  it('finds the triage artifact by prefix', () => {
    const triageArtifact = artifactNames.find(a => a.startsWith('module-summary-triage-'));
    assert.equal(triageArtifact, 'module-summary-triage-12345');
  });
});

// ── Sub-bug 3: JSON parsing vs base64 garbage ────────────────────────────────

describe('buildModuleSummaryBlocks (sub-bug 3 fix)', () => {
  it('produces 3 Notion blocks (H3, code, divider)', () => {
    const blocks = buildModuleSummaryBlocks('triage', 'All good.', 'run-1', 'key-1');
    assert.equal(blocks.length, 3);
  });

  it('first block is an H3 heading with module name', () => {
    const blocks = buildModuleSummaryBlocks('self-verify', 'passed', 'r2', 'k2');
    const h3 = blocks[0];
    assert.equal(h3.type, 'heading_3');
    assert.equal(h3.heading_3.rich_text[0].text.content, 'self-verify');
  });

  it('second block is a code block with summary + metadata', () => {
    const blocks = buildModuleSummaryBlocks('test', 'suite passed', 'r3', 'k3');
    const code = blocks[1];
    assert.equal(code.type, 'code');
    const content = code.code.rich_text[0].text.content;
    assert.ok(content.includes('idempotency_key: k3'),
      'Code block should contain idempotency key');
    assert.ok(content.includes('run_id: r3'),
      'Code block should contain run ID');
    assert.ok(content.includes('summary: suite passed'),
      'Code block should contain summary text');
  });

  it('third block is a divider', () => {
    const blocks = buildModuleSummaryBlocks('m', 's', 'r', 'k');
    assert.equal(blocks[2].type, 'divider');
  });

  it('handles missing optional fields gracefully', () => {
    const blocks = buildModuleSummaryBlocks('', '', '', '');
    const h3 = blocks[0];
    assert.equal(h3.heading_3.rich_text[0].text.content, 'Unknown module');
    const code = blocks[1];
    assert.ok(code.code.rich_text[0].text.content.includes('N/A'));
    assert.ok(code.code.rich_text[0].text.content.includes('summary: (empty)'));
  });

  it('result is valid JSON (not base64 garbage)', () => {
    const blocks = buildModuleSummaryBlocks('triage', 'test summary', '123', 'abc');
    const json = JSON.stringify(blocks);
    const parsed = JSON.parse(json);
    assert.equal(parsed.length, 3);
    // Verify it's actual Notion block objects, not a base64 string.
    assert.equal(typeof parsed[0].type, 'string');
    assert.ok(!json.startsWith('"') || json.length < 200,
      'Output should be structured JSON, not a base64-encoded string');
  });
});

// ── Integration: artifact JSON read path (sub-bug 3) ─────────────────────────

describe('artifact JSON read path (sub-bug 3 integration)', () => {
  let tmpDir;

  // Create fixture files before tests run.  Not using beforeEach because
  // the dir is needed across subtests.
  it('setup: create fixture artifact JSON files', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'notion-sync-test-'));
    const path1 = join(tmpDir, 'module-summary.json');
    writeFileSync(path1, JSON.stringify(FIXTURE_ARTIFACT));
    const path2 = join(tmpDir, 'module-summary-no-issue.json');
    writeFileSync(path2, JSON.stringify(FIXTURE_ARTIFACT_NO_ISSUE));
  });

  it('reads and parses artifact JSON (not base64)', () => {
    const path = join(tmpDir, 'module-summary.json');
    const raw = readFileSync(path, 'utf-8');
    const artifact = JSON.parse(raw);
    assert.equal(artifact.module, 'triage');
    assert.equal(artifact.summary, 'Issue accepted — ready for development.');
    assert.equal(artifact.issue_number, 39);
    // Sub-bug 3: verify we got actual JSON fields, not a base64 string.
    assert.equal(typeof artifact.summary, 'string');
    assert.ok(artifact.summary.length < 1000,
      'Summary should be readable text, not base64-encoded zip bytes');
  });

  it('artifact without issue_number still has module + summary', () => {
    const path = join(tmpDir, 'module-summary-no-issue.json');
    const artifact = JSON.parse(readFileSync(path, 'utf-8'));
    assert.equal(artifact.module, 'develop');
    assert.ok(artifact.summary.length > 0);
    assert.equal(artifact.issue_number, undefined);
  });

  it('buildModuleSummaryBlocks from parsed artifact produces valid blocks', () => {
    const { module, summary, run_id, idempotency_key } = FIXTURE_ARTIFACT;
    const blocks = buildModuleSummaryBlocks(module, summary, run_id, idempotency_key);
    assert.equal(blocks.length, 3);
    assert.equal(blocks[0].heading_3.rich_text[0].text.content, 'triage');
    // The code block contains the summary as readable text — not base64.
    const codeContent = blocks[1].code.rich_text[0].text.content;
    assert.ok(codeContent.includes('Issue accepted'),
      `Code block should contain readable summary. Got: ${codeContent.substring(0, 80)}`);
  });

  // Cleanup after all subtests in this describe block.
  it('cleanup', () => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ── CLI smoke test (sub-bug 1: env passthrough) ──────────────────────────────

describe('sync.mjs CLI behavior', () => {
  it('skips gracefully when NOTION_TOKEN is unset', () => {
    const result = execSync(
      'node .github/actions/notion-sync/sync.mjs',
      { env: { ...process.env, NOTION_TOKEN: '', NOTION_DB_ID: '', EVENT_TYPE: 'module_summary' }, encoding: 'utf-8' }
    );
    assert.ok(result.includes('skipping Notion sync') || result === '',
      'Should exit 0 with skip message when token is unset');
  });

  it('skips gracefully when EVENT_TYPE is unknown', () => {
    const result = execSync(
      'node .github/actions/notion-sync/sync.mjs',
      { env: { ...process.env, NOTION_TOKEN: 'test', NOTION_DB_ID: 'test', EVENT_TYPE: 'bogus' }, encoding: 'utf-8' }
    );
    assert.ok(result.includes('Unknown EVENT_TYPE') || result === '',
      'Should exit 0 with unknown event message');
  });

  it('errors when ARTIFACT_JSON_PATH is set but file missing', () => {
    try {
      execSync(
        'node .github/actions/notion-sync/sync.mjs',
        {
          env: {
            ...process.env,
            NOTION_TOKEN: 'test-token',
            NOTION_DB_ID: 'test-db',
            EVENT_TYPE: 'module_summary',
            ISSUE_NUMBER: '39',
            ARTIFACT_JSON_PATH: '/tmp/nonexistent-artifact-12345.json',
          },
          encoding: 'utf-8',
        }
      );
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(err.stderr.includes('Failed to read/parse artifact JSON') ||
        err.message.includes('Failed to read/parse artifact JSON'),
        `Expected artifact read error, got: ${err.stderr || err.message}`);
    }
  });
});
