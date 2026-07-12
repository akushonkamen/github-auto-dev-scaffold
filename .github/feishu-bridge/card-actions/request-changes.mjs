/**
 * card-actions/request-changes.mjs — review.completed 卡片上 "Request Changes" 按钮的处理器
 *
 * 触发事件：飞书 `card.action.trigger`，按钮 tag = `button`（飞书默认）
 * 派发字段：bridge 读 `action.value.action === 'request_changes'` 路由到本 handler
 *
 * 与 approve-button 共享 actions/pr-review.mjs，差异：
 *   - review event = REQUEST_CHANGES（而非 APPROVE）
 *   - audit comment action 标签 = request_changes
 */
import { executePrReview } from '../actions/pr-review.mjs';
import { parseTargetFromValue } from './approve-button.mjs';

/** Semantic action discriminator in button value (NOT the Feishu element tag). */
export const REQUEST_CHANGES_ACTION = 'request_changes';

/**
 * @param {object} opts — same shape as handleApproveButton
 */
export async function handleRequestChangesButton({ action, openId, masterKey, lookupFn, deps }) {
  const value = action?.value;
  const target = parseTargetFromValue(value);
  if (!target) {
    return { reply: 'Request Changes button missing PR target — card value malformed.' };
  }
  return executePrReview({
    openId, target, masterKey, lookupFn, deps, event: 'REQUEST_CHANGES',
  });
}
