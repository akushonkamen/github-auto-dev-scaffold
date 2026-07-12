/**
 * commands/approve.mjs — /approve <PR#> or /approve <PR-url>
 *
 * Flow:
 *   1. resolve binding (github_user + PAT) from identity-store via masterKey
 *   2. fetch PR changed files list
 *   3. fetch CODEOWNERS content (every call GET + If-None-Match; cache is
 *      per-call only — defense against stale rules after a CODEOWNERS PR)
 *   4. parse + verify github_user owns at least one changed file
 *   5. POST APPROVE review using user's PAT
 *   6. POST audit comment (sha256(open_id)[:12], not raw open_id)
 *   7. reply on Feishu with success / specific error
 *
 * S7 red line: every GitHub API write uses the bound user's PAT, never a
 * machine token. Non-owner → no GitHub side effects (verified by test).
 *
 * All network calls injected via `deps` for unit testability.
 */
import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';
import { parseCodeowners, isOwnerOfAnyFile } from '../codeowners-lib.mjs';

const PR_URL_RE = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[/?#].*)?$/;
const NUM_RE = /^#?(\d+)$/;

/** sha256(open_id)[:12] — safe to log; not PII per plan §Observability. */
export function hashOpenIdForAudit(openId) {
  return crypto.createHash('sha256').update(String(openId)).digest('hex').slice(0, 12);
}

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
 * Always sends a conditional request (never trusts local-only cache).
 *
 * Returns { content, etag, hit } where hit=true means 304 (use cache).
 */
export async function fetchCodeownersWithEtag({ octokit, owner, repo, path, cache }) {
  const headers = {};
  if (cache?.etag) headers['If-None-Match'] = cache.etag;
  const res = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
    owner,
    repo,
    path,
    headers,
  });
  // 304 — server says cache still valid
  if (res.status === 304 || res.status === '304') {
    if (!cache?.content) {
      throw new Error('server returned 304 but no local cache — race condition');
    }
    return { content: cache.content, etag: cache.etag, hit: true };
  }
  // 200 — new content
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
 * @param {object} opts.deps — injected GitHub API surface:
 *   - createOctokit(pat) → octokit
 *   - fetchPRFiles(octokit, owner, repo, prNumber) → string[]
 *   - fetchCodeowners(octokit, owner, repo, cache) → { content, etag, hit }
 *   - postReview(octokit, owner, repo, prNumber, event) → review
 *   - postIssueComment(octokit, owner, repo, issueNumber, body) → comment
 *   - cache — optional { etag, content } for ETag reuse
 */
export async function handleApprove({
  openId,
  args,
  masterKey,
  lookupFn,
  bindRepo,
  deps,
}) {
  if (!openId) throw new Error('openId required');
  if (!masterKey) throw new Error('masterKey required');
  if (!lookupFn) throw new Error('lookupFn required');
  if (!deps?.createOctokit || !deps.fetchPRFiles || !deps.fetchCodeowners || !deps.postReview || !deps.postIssueComment) {
    throw new Error('deps incomplete: require createOctokit, fetchPRFiles, fetchCodeowners, postReview, postIssueComment');
  }
  const arg = (args || [])[0];
  let target;
  try {
    target = parseApproveArg(arg, bindRepo);
  } catch (e) {
    return { reply: `Bad argument: ${e.message}` };
  }

  const binding = await lookupFn({ openId, masterKey });
  if (!binding) {
    return { reply: 'Not bound — run /bind <github-username> first.' };
  }

  let patString;
  try {
    patString = binding.pat.toString('utf8');
  } finally {
    // caller owns wiping binding.pat Buffer
  }

  const auditHash = hashOpenIdForAudit(openId);
  const githubUser = binding.github_user;

  try {
    const octokit = deps.createOctokit(patString);
    const [files, codeowners] = await Promise.all([
      deps.fetchPRFiles(octokit, target.owner, target.repo, target.prNumber),
      deps.fetchCodeowners(octokit, target.owner, target.repo, deps.cache),
    ]);

    if (!Array.isArray(files) || files.length === 0) {
      return { reply: `PR #${target.prNumber} has no changed files — nothing to approve.` };
    }

    const entries = parseCodeowners(codeowners.content);
    if (!isOwnerOfAnyFile(files, githubUser, entries)) {
      // S7: NO GitHub write side effects for non-owners
      return {
        reply:
          `❌ Rejected: @${githubUser} is not a CODEOWNER of any file in PR #${target.prNumber}.\n` +
          `Approvals are limited to CODEOWNERS (S7 red line).`,
      };
    }

    // Owner verified → APPROVE
    await deps.postReview(octokit, target.owner, target.repo, target.prNumber, 'APPROVE');

    const auditBody =
      `🤖 action=approved via feishu ` +
      `by=@${githubUser} ` +
      `feishu_user_hash=${auditHash} ` +
      `timestamp=${new Date().toISOString()}`;
    await deps.postIssueComment(octokit, target.owner, target.repo, target.prNumber, auditBody);

    return {
      reply: `✅ approved PR #${target.prNumber} in ${target.owner}/${target.repo} as @${githubUser}`,
    };
  } finally {
    // Best-effort wipe of the plaintext PAT string copy
    if (patString) {
      try {
        Buffer.from(patString).fill(0);
      } catch { /* noop */ }
    }
  }
}
