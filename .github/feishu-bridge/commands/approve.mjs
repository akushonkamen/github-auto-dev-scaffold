/**
 * commands/approve.mjs — /approve <PR#> or /approve <PR-url>
 *
 * 命令入口；review 执行逻辑在 actions/pr-review.mjs（与 card-actions/ 共享）。
 *
 * 解析 arg → target，转交 executePrReview(event=APPROVE)。
 */
import { executePrReview, hashOpenIdForAudit } from '../actions/pr-review.mjs';

// Re-export hashOpenIdForAudit for tests that import from commands/approve.mjs
export { hashOpenIdForAudit };

const PR_URL_RE = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[/?#].*)?$/;
const NUM_RE = /^#?(\d+)$/;

/**
 * Parse /approve argument into { owner, repo, prNumber }.
 * Throws on malformed input.
 *
 * @param {string} arg
 * @param {string|null} defaultRepo — owner/repo from FEISHU_BIND_REPO env
 */
export function parseApproveArg(arg, defaultRepo) {
  if (typeof arg !== 'string' || arg.length === 0) {
    throw new Error('missing argument: /approve <PR#> or /approve <PR-url>');
  }
  const urlMatch = arg.match(PR_URL_RE);
  if (urlMatch) {
    return { owner: urlMatch[1], repo: urlMatch[2], prNumber: Number(urlMatch[3]) };
  }
  const numMatch = arg.match(NUM_RE);
  if (numMatch) {
    if (!defaultRepo) {
      throw new Error('repo not configured — pass full PR URL or set FEISHU_BIND_REPO');
    }
    const parts = defaultRepo.split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new Error(`invalid FEISHU_BIND_REPO: "${defaultRepo}" — expected "owner/repo"`);
    }
    return { owner: parts[0], repo: parts[1], prNumber: Number(numMatch[1]) };
  }
  throw new Error(`could not parse argument: "${arg}"`);
}

/**
 * Fetch CODEOWNERS content from GitHub contents API with ETag cache control.
 * Kept here for backwards-compat with bridge.mjs which imports it directly.
 */
export async function fetchCodeownersWithEtag({ octokit, owner, repo, path, cache }) {
  const headers = {};
  if (cache?.etag) headers['If-None-Match'] = cache.etag;
  const res = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
    owner, repo, path, headers,
  });
  if (res.status === 304 || res.status === '304') {
    if (!cache?.content) {
      throw new Error('server returned 304 but no local cache — race condition');
    }
    return { content: cache.content, etag: cache.etag, hit: true };
  }
  const content = Buffer.from(res.data.content, 'base64').toString('utf8');
  return { content, etag: res.headers?.etag ?? null, hit: false };
}

/**
 * /approve handler.
 *
 * @param {object} opts
 * @param {string} opts.openId
 * @param {string[]} opts.args
 * @param {Buffer} opts.masterKey
 * @param {function} opts.lookupFn — identity-store.lookup
 * @param {string|null} opts.bindRepo — owner/repo default
 * @param {object} opts.deps — see actions/pr-review.mjs executePrReview
 */
export async function handleApprove({ openId, args, masterKey, lookupFn, bindRepo, deps }) {
  if (!openId) throw new Error('openId required');
  if (!masterKey) throw new Error('masterKey required');
  if (!lookupFn) throw new Error('lookupFn required');
  const arg = (args || [])[0];
  let target;
  try {
    target = parseApproveArg(arg, bindRepo);
  } catch (e) {
    return { reply: `Bad argument: ${e.message}` };
  }
  return executePrReview({
    openId, target, masterKey, lookupFn, deps, event: 'APPROVE',
  });
}
