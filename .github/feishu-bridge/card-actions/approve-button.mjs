/**
 * card-actions/approve-button.mjs — review.completed 卡片上 "Approve" 按钮的处理器
 *
 * 触发事件：飞书 `card.action.trigger`，按钮 tag = `approve_btn`
 *
 * 按钮 value（由 sync.mjs renderReviewCard 生成）：
 *   { "owner": "akushonkamen", "repo": "scaffold", "pr_number": 123 }
 *
 * 处理流程与 /approve 命令等价，差异仅在 target 来源：
 *   - /approve：从命令 arg 解析 URL 或 PR#
 *   - 按钮：直接从 value 字段读取
 *
 * S7：非 owner 点击 → 零 GitHub 写入，与 /approve 一致。
 */
import { executePrReview } from '../actions/pr-review.mjs';

export const APPROVE_BTN_TAG = 'approve_btn';

/**
 * @param {object} opts
 * @param {object} opts.action — Feishu card action payload (event.event.action)
 * @param {string} opts.openId — Feishu sender open_id
 * @param {Buffer} opts.masterKey
 * @param {function} opts.lookupFn
 * @param {object} opts.deps — injected GitHub API surface (see actions/pr-review.mjs)
 * @returns {Promise<{reply:string}>}
 */
export async function handleApproveButton({ action, openId, masterKey, lookupFn, deps }) {
  const value = action?.value;
  const target = parseTargetFromValue(value);
  if (!target) {
    return { reply: 'Approve button missing PR target — card value malformed.' };
  }
  return executePrReview({
    openId, target, masterKey, lookupFn, deps, event: 'APPROVE',
  });
}

/**
 * Validate + normalize the button value payload into a target tuple.
 * Returns null on malformed input (handler replies with error, no GitHub calls).
 */
export function parseTargetFromValue(value) {
  if (!value || typeof value !== 'object') return null;
  const { owner, repo, pr_number } = value;
  if (typeof owner !== 'string' || !owner) return null;
  if (typeof repo !== 'string' || !repo) return null;
  const prNumber = Number(pr_number);
  if (!Number.isInteger(prNumber) || prNumber <= 0) return null;
  return { owner, repo, prNumber };
}
