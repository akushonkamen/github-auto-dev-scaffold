/**
 * postcard.test.mjs — Unit tests for PR-2 postCard + token lifecycle
 *
 * All tests mock fetch (no network). Coverage:
 *   - fetchTenantAccessToken success / failure
 *   - getTenantAccessToken caching + expiry
 *   - feishuFetch 401 retry-once behavior
 *   - postCard success / failure / invalid inputs
 *   - renderReviewCard template correctness
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchTenantAccessToken,
  getTenantAccessToken,
  feishuFetch,
  postCard,
  renderReviewCard,
  _resetTokenCacheForTest,
} from '../sync.mjs';

// ---------------------------------------------------------------------------
// Mock fetch helpers
// ---------------------------------------------------------------------------

/** Build a fetch mock that returns the given JSON response. */
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

/** Sequential fetch mock: returns different responses per call. */
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

// ---------------------------------------------------------------------------
// fetchTenantAccessToken
// ---------------------------------------------------------------------------

test('fetchTenantAccessToken returns token on code=0', async () => {
  _resetTokenCacheForTest();
  const fetcher = mockFetch({
    code: 0,
    tenant_access_token: 't-g-test-token-1234567890abcdef',
    expire: 7200,
  });
  const { token, expiresInSec } = await fetchTenantAccessToken({
    appId: 'cli_test',
    appSecret: '0123456789abcdef0123456789abcdef',
    fetcher,
  });
  assert.equal(token, 't-g-test-token-1234567890abcdef');
  assert.equal(expiresInSec, 7200);
  assert.equal(fetcher.calls.length, 1);
  assert.match(fetcher.calls[0].url, /auth\/v3\/tenant_access_token\/internal/);
});

test('fetchTenantAccessToken throws on non-zero code', async () => {
  _resetTokenCacheForTest();
  const fetcher = mockFetch({ code: 99941672, msg: 'app secret not match' });
  await assert.rejects(
    () => fetchTenantAccessToken({ appId: 'cli_test', appSecret: 'bad', fetcher }),
    /code=99941672/,
  );
});

test('fetchTenantAccessToken rejects missing appId / appSecret', async () => {
  _resetTokenCacheForTest();
  await assert.rejects(
    () => fetchTenantAccessToken({ appId: '', appSecret: '' }),
    /required/,
  );
});

test('fetchTenantAccessToken throws if response missing tenant_access_token', async () => {
  _resetTokenCacheForTest();
  const fetcher = mockFetch({ code: 0 }); // missing tenant_access_token
  await assert.rejects(
    () => fetchTenantAccessToken({ appId: 'cli_test', appSecret: 'secret', fetcher }),
  );
});

// ---------------------------------------------------------------------------
// getTenantAccessToken caching
// ---------------------------------------------------------------------------

test('getTenantAccessToken caches token between calls within expiry window', async () => {
  _resetTokenCacheForTest();
  const fetcher = mockFetch({
    code: 0,
    tenant_access_token: 't-g-cached-token-abcdef123456',
    expire: 7200,
  });
  const t1 = await getTenantAccessToken({ appId: 'cli_test', appSecret: 'sec', fetcher });
  const t2 = await getTenantAccessToken({ appId: 'cli_test', appSecret: 'sec', fetcher });
  assert.equal(t1, 't-g-cached-token-abcdef123456');
  assert.equal(t2, t1);
  assert.equal(fetcher.calls.length, 1, 'should only fetch once — second call served from cache');
});

test('getTenantAccessToken refetches when expiry is past', async () => {
  _resetTokenCacheForTest();
  let now = 1_000_000;
  const fetcher = mockFetch({
    code: 0,
    tenant_access_token: 't-g-first-fetch-1234567890',
    expire: 7200,
  });
  await getTenantAccessToken({ appId: 'cli', appSecret: 's', fetcher, now: () => now });
  now += 7200 * 1000 + 1; // expire past
  await getTenantAccessToken({ appId: 'cli', appSecret: 's', fetcher, now: () => now });
  assert.equal(fetcher.calls.length, 2, 'should refetch after expiry');
});

// ---------------------------------------------------------------------------
// feishuFetch 401 retry
// ---------------------------------------------------------------------------

test('feishuFetch retries once on 401 with token refetch', async () => {
  _resetTokenCacheForTest();
  const goodToken = { code: 0, tenant_access_token: 't-g-good-token-1234567890', expire: 7200 };
  const apiSuccess = { code: 0, data: { message_id: 'om_test_msg_1' } };

  // Call sequence:
  //   1. token fetch #1
  //   2. API call → 401
  //   3. token fetch #2 (after cache invalidation)
  //   4. API call → 200
  const responses = [
    { json: goodToken, status: 200 },      // token #1
    { json: { code: 401, msg: 'invalid token' }, status: 401 }, // API call #1
    { json: goodToken, status: 200 },      // token #2 (after 401 reset)
    { json: apiSuccess, status: 200 },     // API call #2 → success
  ];
  const fetcher = sequentialFetch(responses);

  const result = await feishuFetch('/open-apis/im/v1/messages', {
    method: 'POST',
    body: { receive_id: 'oc_test', msg_type: 'text', content: '{}' },
    appId: 'cli', appSecret: 's', fetcher,
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(fetcher.calls.length, 4, 'should make 4 fetch calls: 2 token + 2 API');
});

test('feishuFetch does not retry more than once on repeated 401', async () => {
  _resetTokenCacheForTest();
  const token = { code: 0, tenant_access_token: 't-g-bad-token-1234567890', expire: 7200 };
  const always401 = { json: { code: 401, msg: 'invalid token' }, status: 401 };
  const fetcher = sequentialFetch([
    { json: token, status: 200 }, // token #1
    always401,                    // API #1 → 401
    { json: token, status: 200 }, // token #2 (refresh)
    always401,                    // API #2 → 401 (give up)
  ]);

  const result = await feishuFetch('/open-apis/im/v1/messages', {
    method: 'GET', appId: 'cli', appSecret: 's', fetcher,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
});

// ---------------------------------------------------------------------------
// postCard
// ---------------------------------------------------------------------------

test('postCard returns ok + messageId on success', async () => {
  _resetTokenCacheForTest();
  const token = { code: 0, tenant_access_token: 't-g-postcard-1234567890', expire: 7200 };
  const sendOk = { code: 0, data: { message_id: 'om_test_postcard_1' } };
  const fetcher = sequentialFetch([
    { json: token, status: 200 },
    { json: sendOk, status: 200 },
  ]);

  const result = await postCard({
    chatId: 'oc_test_chat',
    msgType: 'text',
    content: { text: 'hello from postCard test' },
    appId: 'cli', appSecret: 's', fetcher,
  });

  assert.equal(result.ok, true);
  assert.equal(result.messageId, 'om_test_postcard_1');
});

test('postCard sends receive_id_type=chat_id in query string', async () => {
  _resetTokenCacheForTest();
  const token = { code: 0, tenant_access_token: 't-g-test-1234567890', expire: 7200 };
  const sendOk = { code: 0, data: { message_id: 'om_x' } };
  const fetcher = sequentialFetch([
    { json: token, status: 200 },
    { json: sendOk, status: 200 },
  ]);

  await postCard({
    chatId: 'oc_abc',
    content: { text: 'x' },
    appId: 'cli', appSecret: 's', fetcher,
  });

  const apiCall = fetcher.calls[1];
  assert.match(apiCall.url, /receive_id_type=chat_id/);
});

test('postCard returns error when chatId is empty', async () => {
  _resetTokenCacheForTest();
  const result = await postCard({
    chatId: '',
    content: { text: 'x' },
    appId: 'cli', appSecret: 's',
    fetcher: async () => { throw new Error('should not fetch'); },
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /chatId required/);
});

test('postCard returns error when content is missing', async () => {
  _resetTokenCacheForTest();
  const result = await postCard({
    chatId: 'oc_x',
    content: null,
    appId: 'cli', appSecret: 's',
    fetcher: async () => { throw new Error('should not fetch'); },
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /content required/);
});

test('postCard surfaces Feishu API error code + msg', async () => {
  _resetTokenCacheForTest();
  const token = { code: 0, tenant_access_token: 't-g-test-1234567890', expire: 7200 };
  const apiErr = { code: 230002, msg: 'bot not in chat' };
  const fetcher = sequentialFetch([
    { json: token, status: 200 },
    { json: apiErr, status: 200 }, // HTTP 200 but Feishu code != 0
  ]);

  const result = await postCard({
    chatId: 'oc_wrong_chat',
    content: { text: 'x' },
    appId: 'cli', appSecret: 's', fetcher,
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /230002/);
  assert.match(result.error, /bot not in chat/);
});

// ---------------------------------------------------------------------------
// renderReviewCard
// ---------------------------------------------------------------------------

test('renderReviewCard approved verdict gets ✅ emoji', () => {
  const card = renderReviewCard({
    prNumber: 42,
    prTitle: 'Fix auth flow',
    prUrl: 'https://github.com/owner/repo/pull/42',
    reviewer: 'alice',
    verdict: 'approved',
  });
  assert.match(card.text, /✅/);
  assert.match(card.text, /#42/);
  assert.match(card.text, /Fix auth flow/);
  assert.match(card.text, /Reviewer: alice/);
});

test('renderReviewCard changes_requested verdict gets 🔁', () => {
  const card = renderReviewCard({
    prNumber: 7,
    prTitle: 'x',
    prUrl: 'u',
    verdict: 'changes_requested',
  });
  assert.match(card.text, /🔁/);
});

test('renderReviewCard omits reviewer line when reviewer missing', () => {
  const card = renderReviewCard({
    prNumber: 1, prTitle: 't', prUrl: 'u', verdict: 'completed',
  });
  assert.doesNotMatch(card.text, /Reviewer:/);
});

test('renderReviewCard unknown verdict falls back to 🔔', () => {
  const card = renderReviewCard({
    prNumber: 1, prTitle: 't', prUrl: 'u', verdict: undefined,
  });
  assert.match(card.text, /🔔/);
});
