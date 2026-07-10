import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderCodeowners } from '../lib/steps/08-codeowners.mjs';

test('renders maintainers as global owner', () => {
  const body = renderCodeowners({ maintainers: 'akushonkamen', secTeam: '', architects: '' });
  assert.match(body, /^\* @akushonkamen$/m);
});

test('renders sec-team for security paths when present', () => {
  const body = renderCodeowners({ maintainers: 'maint', secTeam: 'org/sec', architects: '' });
  assert.match(body, /\/\.github\/workflows\/ @org\/sec/);
  assert.match(body, /\/\.github\/actions\/ @org\/sec/);
  assert.match(body, /\/docs\/security\.md @org\/sec/);
});

test('renders architects for CLAUDE.md when present', () => {
  const body = renderCodeowners({ maintainers: 'm', secTeam: '', architects: 'org/arch' });
  assert.match(body, /\/CLAUDE\.md @org\/arch/);
  assert.match(body, /\/docs\/architecture\.md @org\/arch/);
});

test('omits sec section when secTeam blank', () => {
  const body = renderCodeowners({ maintainers: 'm', secTeam: '', architects: '' });
  assert.doesNotMatch(body, /security\.md/);
});

test('every non-comment line has an @owner', () => {
  const body = renderCodeowners({ maintainers: 'm', secTeam: 's', architects: 'a' });
  for (const line of body.split('\n')) {
    if (line.trim() === '' || line.startsWith('#')) continue;
    assert.match(line, /@/, `line without owner: "${line}"`);
  }
});
