/**
 * actions/pr-review.mjs — 共享的 PR review 执行逻辑
 *
 * 由两条入口复用：
 *   - commands/approve.mjs       (/approve <PR#|url>)
 *   - card-actions/*.mjs          (Approve / Request Changes 按钮)
 *
 * Flow:
 *   1. resolve binding (github_user + PAT) from identity-store via masterKey
 *   2. fetch PR changed files list
 *   3. fetch CODEOWNERS (every call GET + If-None-Match; cache is per-call only)
 *   4. parse + verify github_user owns at least one changed file
 *   5. POST review (event = APPROVE | REQUEST_CHANGES) using user's PAT
 *   6. POST audit comment (sha256(open_id)[:12], not raw open_id)
 *   7. return { reply } — caller decides how to deliver (DM text / card update)
 *
 * S7 红线：所有 GitHub 写入用绑定用户的 fine-grained PAT；非 owner → 零写入。
 */
import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';
import { parseCodeowners, isOwnerOfAnyFile } from '../codeowners-lib.mjs';

/** sha256(open_id)[:12] — safe to log; not PII per plan §Observability. */
export function hashOpenIdForAudit(openId) {
  return crypto.createHash('sha256').update(String(openId)).digest('hex').slice(0, 12);
}

/**
 * Execute a CODEOWNERS-gated PR review action.
 *
 * @param {object} opts
 * @param {string} opts.openId — Feishu sender open_id (for binding lookup + audit hash)
 * @param {{owner:string, repo:string, prNumber:number}} opts.target — resolved PR target
 * @param {Buffer} opts.masterKey — Keychain master key for identity-store
 * @param {function} opts.lookupFn — identity-store.lookup({openId, masterKey}) → binding|null
 * @param {object} opts.deps — injected GitHub API surface
 * @param {'APPROVE'|'REQUEST_CHANGES'} [opts.event='APPROVE']
 * @returns {Promise<{reply:string}>}
 */
export async function executePrReview({
  openId,
  target,
  masterKey,
  lookupFn,
  deps,
  event = 'APPROVE',
}) {
  if (!openId) throw new Error('openId required');
  if (!masterKey) throw new Error('masterKey required');
  if (!lookupFn) throw new Error('lookupFn required');
  if (!target?.owner || !target.repo || !target.prNumber) {
    throw new Error('target { owner, repo, prNumber } required');
  }
  if (event !== 'APPROVE' && event !== 'REQUEST_CHANGES') {
    throw new Error(`unsupported review event: ${event}`);
  }
  if (!deps?.createOctokit || !deps.fetchPRFiles || !deps.fetchCodeowners || !deps.postReview || !deps.postIssueComment) {
    throw new Error('deps incomplete: require createOctokit, fetchPRFiles, fetchCodeowners, postReview, postIssueComment');
  }

  const binding = await lookupFn({ openId, masterKey });
  if (!binding) {
    return { reply: 'Not bound — run /bind <github-username> first.' };
  }

  const auditHash = hashOpenIdForAudit(openId);
  const githubUser = binding.github_user;
  let patString;

  try {
    patString = binding.pat.toString('utf8');
    const octokit = deps.createOctokit(patString);

    const [files, codeowners] = await Promise.all([
      deps.fetchPRFiles(octokit, target.owner, target.repo, target.prNumber),
      deps.fetchCodeowners(octokit, target.owner, target.repo, deps.cache),
    ]);

    if (!Array.isArray(files) || files.length === 0) {
      return { reply: `PR #${target.prNumber} has no changed files — nothing to review.` };
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

    // Owner verified → POST review
    await deps.postReview(octokit, target.owner, target.repo, target.prNumber, event);

    const verb = event === 'APPROVE' ? 'approved' : 'requested changes on';
    const emoji = event === 'APPROVE' ? '✅' : '🔁';
    const auditBody =
      `🤖 action=${event === 'APPROVE' ? 'approved' : 'request_changes'} via feishu ` +
      `by=@${githubUser} ` +
      `feishu_user_hash=${auditHash} ` +
      `timestamp=${new Date().toISOString()}`;
    await deps.postIssueComment(octokit, target.owner, target.repo, target.prNumber, auditBody);

    return {
      reply: `${emoji} ${verb} PR #${target.prNumber} in ${target.owner}/${target.repo} as @${githubUser}`,
    };
  } finally {
    // Best-effort wipe of the plaintext PAT string copy (S6)
    if (patString) {
      try {
        Buffer.from(patString).fill(0);
      } catch { /* noop */ }
    }
  }
}
