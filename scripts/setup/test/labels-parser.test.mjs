import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseLabelsYml } from '../lib/steps/07-labels.mjs';

const FIXTURE = `# labels.yml
- name: triage
  color: fbca04
  description: "Module 2 — auto-applied on issue open"

- name: needs-clarify
  color: fef2c0
  description: 'complex issue awaiting clarification'

- name: accepted-by-claude
  color: 0e8a16
  description: claude self-acceptance (S2)
`;

test('parses a 3-label fixture', () => {
  const out = parseLabelsYml(FIXTURE);
  assert.equal(out.length, 3);
  assert.deepEqual(
    out.map((l) => l.name),
    ['triage', 'needs-clarify', 'accepted-by-claude'],
  );
});

test('strips quotes from quoted values', () => {
  const out = parseLabelsYml(FIXTURE);
  assert.equal(out[0].description, 'Module 2 — auto-applied on issue open');
  assert.equal(out[1].description, 'complex issue awaiting clarification');
});

test('normalizes color (no leading #)', () => {
  const out = parseLabelsYml('- name: x\n  color: "#abcdef"\n  description: y\n');
  assert.equal(out[0].color, 'abcdef');
});

test('ignores blank lines and comments', () => {
  const out = parseLabelsYml('\n\n# comment\n- name: only\n  color: "000000"\n  description: y\n');
  assert.equal(out.length, 1);
  assert.equal(out[0].name, 'only');
});

test('skips entries without a name', () => {
  const out = parseLabelsYml('- color: "000000"\n  description: y\n');
  assert.equal(out.length, 0);
});

test('parses real .github/labels.yml', async () => {
  const { readFileSync } = await import('node:fs');
  const { existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  const path = join(process.cwd(), '..', '..', '.github', 'labels.yml');
  if (!existsSync(path)) return; // tolerate running outside repo root
  const out = parseLabelsYml(readFileSync(path, 'utf-8'));
  assert.ok(out.length >= 20, `expected ≥20 labels, got ${out.length}`);
  for (const l of out) {
    assert.ok(l.name, 'label missing name');
    assert.match(l.color, /^[0-9a-fA-F]{6}$/, `bad color for ${l.name}: ${l.color}`);
  }
});
