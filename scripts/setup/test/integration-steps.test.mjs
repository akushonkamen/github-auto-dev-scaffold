/**
 * Integration test: Step 0 (preflight) run() returns {status:'ok'} when
 * gh is authenticated, node >=20, git present. No mocking — relies on the
 * dev environment having gh authed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as step00 from '../lib/steps/00-preflight.mjs';

test('Step 0 preflight — happy path returns ok', async () => {
  const ctx = {
    preview: silentPreview(),
    state: {},
  };
  const r = await step00.run(ctx);
  assert.equal(r.status, 'ok', 'preflight should succeed on a healthy dev box');
  assert.ok(ctx.ghAccount, 'ghAccount should be populated on success');
});

test('Step 0 preflight — exposes ghAccount for downstream steps', async () => {
  const ctx = {
    preview: silentPreview(),
    state: {},
  };
  await step00.run(ctx);
  assert.equal(typeof ctx.ghAccount, 'string');
  assert.ok(ctx.ghAccount.length > 0);
});

function silentPreview() {
  return new Proxy({}, { get: () => () => {} });
}
