/**
 * bitable.test.mjs — Unit tests for PR-3 Bitable upsert + Issue state mirror
 *
 * All tests mock fetch (no network). Coverage:
 *   - shortenOpenId — sha256[:12] PII shortening
 *   - renderIssueRow — field mapping (Number/String/Array/ms timestamp)
 *   - findBitableRecord — search hit / miss / API error
 *   - bitableUpsert — update path (found) / create path (not found) / missing Issue Number
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shortenOpenId,
  renderIssueRow,
  findBitableRecord,
  bitableUpsert,
  _resetTokenCacheForTest,
} from '../sync.mjs';

// ---------------------------------------------------------------------------
// Mock fetch helpers (mirrors postcard.test.mjs patterns)
// ---------------------------------------------------------------------------

function mockFetch(jsonResponse, status = 200) {
  const calls = [];
  const fetcher = async (url, opts) => {
    calls.push({ url, opts });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => jsonResponse,
    };
  };
  fetcher.calls = calls;
  return fetcher;
}

function sequentialFetch(responses) {
  const calls = [];
  let i = 0;
  const fetcher = async (url, opts) => {
    calls.push({ url, opts });
    const { json, status = 200 } = responses[i] || responses[responses.length - 1];
    i++;
    return { ok: status >= 200 && status < 300, status, json: async () => json };
  };
  fetcher.calls = calls;
  return fetcher;
}

// Token + API success payloads shared across tests
const TOKEN_RESP = { code: 0, tenant_access_token: 't-g-test-bitable-1234567890', expire: 7200 };

// ---------------------------------------------------------------------------
// shortenOpenId
// ---------------------------------------------------------------------------

test('shortenOpenId returns 12-char hex string', () => {
  const out = shortenOpenId('ou_test_user_id_abcdef123456');
  assert.equal(out.length, 12);
  assert.match(out, /^[0-9a-f]{12}$/);
});

test('shortenOpenId is deterministic — same input same output', () => {
  const a = shortenOpenId('ou_user_x');
  const b = shortenOpenId('ou_user_x');
  assert.equal(a, b);
});

test('shortenOpenId differs for different inputs', () => {
  const a = shortenOpenId('ou_user_a');
  const b = shortenOpenId('ou_user_b');
  assert.notEqual(a, b);
});

test('shortenOpenId coerces non-string input to string', () => {
  const out = shortenOpenId(12345);
  assert.equal(out.length, 12);
  assert.match(out, /^[0-9a-f]{12}$/);
});

// ---------------------------------------------------------------------------
// renderIssueRow
// ---------------------------------------------------------------------------

test('renderIssueRow maps all fields with correct types', () => {
  const row = renderIssueRow({
    number: 42,
    title: 'Fix auth flow',
    state: 'in-review',
    labels: ['bug', 'claude'],
    assignees: ['ou_alice', 'ou_bob'],
    updatedAt: '2026-07-11T10:00:00Z',
  });
  assert.equal(row['Issue Number'], 42);
  assert.equal(row['Title'], 'Fix auth flow');
  assert.equal(row['State'], 'in-review');
  assert.deepEqual(row['Labels'], ['bug', 'claude']);
  assert.equal(row['Assignees'].length, 2);
  row['Assignees'].forEach((a) => assert.match(a, /^[0-9a-f]{12}$/));
  assert.equal(typeof row['Updated At'], 'number');
  assert.equal(row['Updated At'], new Date('2026-07-11T10:00:00Z').getTime());
});

test('renderIssueRow accepts numeric updatedAt as ms timestamp', () => {
  const ts = 1720000000000;
  const row = renderIssueRow({ number: 1, title: 'x', updatedAt: ts });
  assert.equal(row['Updated At'], ts);
});

test('renderIssueRow defaults updatedAt to Date.now() when missing', () => {
  const before = Date.now();
  const row = renderIssueRow({ number: 1, title: 'x' });
  const after = Date.now();
  assert.ok(row['Updated At'] >= before && row['Updated At'] <= after);
});

test('renderIssueRow defaults State to "triage"', () => {
  const row = renderIssueRow({ number: 1, title: 'x' });
  assert.equal(row['State'], 'triage');
});

test('renderIssueRow coerces number to Number type and title to String', () => {
  const row = renderIssueRow({ number: '007', title: 123 });
  assert.equal(row['Issue Number'], 7);
  assert.equal(row['Title'], '123');
});

test('renderIssueRow handles empty labels / assignees', () => {
  const row = renderIssueRow({ number: 1, title: 'x', labels: [], assignees: [] });
  assert.deepEqual(row['Labels'], []);
  assert.deepEqual(row['Assignees'], []);
});

test('renderIssueRow handles missing labels / assignees (undefined)', () => {
  const row = renderIssueRow({ number: 1, title: 'x' });
  assert.deepEqual(row['Labels'], []);
  assert.deepEqual(row['Assignees'], []);
});

// ---------------------------------------------------------------------------
// findBitableRecord
// ---------------------------------------------------------------------------

test('findBitableRecord returns recordId when search hits', async () => {
  _resetTokenCacheForTest();
  const apiOk = {
    code: 0,
    data: {
      items: [{ record_id: 'recABC123', fields: { 'Issue Number': 42 } }],
    },
  };
  const fetcher = sequentialFetch([
    { json: TOKEN_RESP, status: 200 },
    { json: apiOk, status: 200 },
  ]);

  const result = await findBitableRecord({
    appId: 'cli', appSecret: 'sec',
    appToken: 'bToken', tableId: 'tblXYZ',
    issueNumber: 42, fetcher,
  });

  assert.equal(result.ok, true);
  assert.equal(result.recordId, 'recABC123');

  // Verify search body structure
  const searchCall = fetcher.calls[1];
  assert.match(searchCall.url, /bitable\/v1\/apps\/bToken\/tables\/tblXYZ\/records\/search/);
  const body = JSON.parse(searchCall.opts.body);
  assert.equal(body.filter.conjunction, 'and');
  assert.equal(body.filter.conditions[0].field_name, 'Issue Number');
  assert.equal(body.filter.conditions[0].operator, 'is');
  assert.deepEqual(body.filter.conditions[0].value, ['42']);
});

test('findBitableRecord returns ok:true without recordId when search misses', async () => {
  _resetTokenCacheForTest();
  const apiEmpty = { code: 0, data: { items: [] } };
  const fetcher = sequentialFetch([
    { json: TOKEN_RESP, status: 200 },
    { json: apiEmpty, status: 200 },
  ]);

  const result = await findBitableRecord({
    appId: 'cli', appSecret: 'sec',
    appToken: 'bToken', tableId: 'tblXYZ',
    issueNumber: 999, fetcher,
  });

  assert.equal(result.ok, true);
  assert.equal(result.recordId, undefined);
});

test('findBitableRecord surfaces API error code + msg', async () => {
  _resetTokenCacheForTest();
  const apiErr = { code: 1254030, msg: 'permission denied' };
  const fetcher = sequentialFetch([
    { json: TOKEN_RESP, status: 200 },
    { json: apiErr, status: 200 },
  ]);

  const result = await findBitableRecord({
    appId: 'cli', appSecret: 'sec',
    appToken: 'bToken', tableId: 'tblXYZ',
    issueNumber: 1, fetcher,
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /1254030/);
  assert.match(result.error, /permission denied/);
});

test('findBitableRecord rejects missing appToken / tableId', async () => {
  _resetTokenCacheForTest();
  const result = await findBitableRecord({
    appId: 'cli', appSecret: 'sec',
    appToken: '', tableId: '',
    issueNumber: 1,
    fetcher: async () => { throw new Error('should not fetch'); },
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /appToken and tableId required/);
});

test('findBitableRecord treats missing data.items as empty result', async () => {
  _resetTokenCacheForTest();
  const apiNoItems = { code: 0, data: {} };
  const fetcher = sequentialFetch([
    { json: TOKEN_RESP, status: 200 },
    { json: apiNoItems, status: 200 },
  ]);

  const result = await findBitableRecord({
    appId: 'cli', appSecret: 'sec',
    appToken: 'b', tableId: 't',
    issueNumber: 1, fetcher,
  });

  assert.equal(result.ok, true);
  assert.equal(result.recordId, undefined);
});

// ---------------------------------------------------------------------------
// bitableUpsert
// ---------------------------------------------------------------------------

test('bitableUpsert UPDATE path: existing record → PUT', async () => {
  _resetTokenCacheForTest();
  const searchHit = {
    code: 0,
    data: { items: [{ record_id: 'recEXIST', fields: { 'Issue Number': 42 } }] },
  };
  const updateOk = {
    code: 0,
    data: { record: { record_id: 'recEXIST', fields: { 'Issue Number': 42 } } },
  };
  const fetcher = sequentialFetch([
    { json: TOKEN_RESP, status: 200 },    // token
    { json: searchHit, status: 200 },     // search → hit
    { json: updateOk, status: 200 },      // PUT update
  ]);

  const fields = renderIssueRow({ number: 42, title: 'updated title' });
  const result = await bitableUpsert({
    appId: 'cli', appSecret: 'sec',
    appToken: 'b', tableId: 't',
    fields, fetcher,
  });

  assert.equal(result.ok, true);
  assert.equal(result.action, 'update');
  assert.equal(result.recordId, 'recEXIST');

  // Verify the PUT call structure
  const putCall = fetcher.calls[2];
  assert.match(putCall.url, /records\/recEXIST$/);
  assert.equal(putCall.opts.method, 'PUT');
  const putBody = JSON.parse(putCall.opts.body);
  assert.equal(putBody.fields['Issue Number'], 42);
  assert.equal(putBody.fields['Title'], 'updated title');
});

test('bitableUpsert CREATE path: no record → POST', async () => {
  _resetTokenCacheForTest();
  const searchMiss = { code: 0, data: { items: [] } };
  const createOk = {
    code: 0,
    data: { record: { record_id: 'recNEW', fields: {} } },
  };
  const fetcher = sequentialFetch([
    { json: TOKEN_RESP, status: 200 },    // token
    { json: searchMiss, status: 200 },    // search → miss
    { json: createOk, status: 200 },      // POST create
  ]);

  const fields = renderIssueRow({ number: 99, title: 'new issue' });
  const result = await bitableUpsert({
    appId: 'cli', appSecret: 'sec',
    appToken: 'b', tableId: 't',
    fields, fetcher,
  });

  assert.equal(result.ok, true);
  assert.equal(result.action, 'create');
  assert.equal(result.recordId, 'recNEW');

  // Verify POST call structure
  const postCall = fetcher.calls[2];
  assert.match(postCall.url, /records$/);
  assert.equal(postCall.opts.method, 'POST');
});

test('bitableUpsert returns error when fields missing Issue Number', async () => {
  _resetTokenCacheForTest();
  const result = await bitableUpsert({
    appId: 'cli', appSecret: 'sec',
    appToken: 'b', tableId: 't',
    fields: { Title: 'no number' },
    fetcher: async () => { throw new Error('should not fetch'); },
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /Issue Number/);
});

test('bitableUpsert accepts Issue Number = 0 as valid (not falsy-blocked)', async () => {
  _resetTokenCacheForTest();
  const searchMiss = { code: 0, data: { items: [] } };
  const createOk = { code: 0, data: { record: { record_id: 'recZero' } } };
  const fetcher = sequentialFetch([
    { json: TOKEN_RESP, status: 200 },
    { json: searchMiss, status: 200 },
    { json: createOk, status: 200 },
  ]);

  const fields = { 'Issue Number': 0, 'Title': 'zero' };
  const result = await bitableUpsert({
    appId: 'cli', appSecret: 'sec',
    appToken: 'b', tableId: 't',
    fields, fetcher,
  });

  assert.equal(result.ok, true);
  assert.equal(result.action, 'create');

  // Verify search was called with '0'
  const searchCall = fetcher.calls[1];
  const searchBody = JSON.parse(searchCall.opts.body);
  assert.deepEqual(searchBody.filter.conditions[0].value, ['0']);
});

test('bitableUpsert propagates search failure', async () => {
  _resetTokenCacheForTest();
  const searchErr = { code: 1254030, msg: 'permission denied' };
  const fetcher = sequentialFetch([
    { json: TOKEN_RESP, status: 200 },
    { json: searchErr, status: 200 },
  ]);

  const result = await bitableUpsert({
    appId: 'cli', appSecret: 'sec',
    appToken: 'b', tableId: 't',
    fields: { 'Issue Number': 1, 'Title': 'x' },
    fetcher,
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /search failed/);
});

test('bitableUpsert surfaces UPDATE API error', async () => {
  _resetTokenCacheForTest();
  const searchHit = {
    code: 0,
    data: { items: [{ record_id: 'recX', fields: {} }] },
  };
  const updateErr = { code: 1254003, msg: 'field type mismatch' };
  const fetcher = sequentialFetch([
    { json: TOKEN_RESP, status: 200 },
    { json: searchHit, status: 200 },
    { json: updateErr, status: 200 },
  ]);

  const result = await bitableUpsert({
    appId: 'cli', appSecret: 'sec',
    appToken: 'b', tableId: 't',
    fields: { 'Issue Number': 1, 'Title': 'x' },
    fetcher,
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /update failed/);
  assert.match(result.error, /1254003/);
});

test('bitableUpsert surfaces CREATE API error', async () => {
  _resetTokenCacheForTest();
  const searchMiss = { code: 0, data: { items: [] } };
  const createErr = { code: 1254001, msg: 'table not found' };
  const fetcher = sequentialFetch([
    { json: TOKEN_RESP, status: 200 },
    { json: searchMiss, status: 200 },
    { json: createErr, status: 200 },
  ]);

  const result = await bitableUpsert({
    appId: 'cli', appSecret: 'sec',
    appToken: 'b', tableId: 't',
    fields: { 'Issue Number': 1, 'Title': 'x' },
    fetcher,
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /create failed/);
  assert.match(result.error, /1254001/);
});
