/**
 * card-actions/request-changes.mjs — review.completed 卡片上 "Request Changes" 按钮的处理器
 *
 * 触发事件：飞书 `card.action.trigger`，按钮 tag = `request_changes_btn`
 *
 * 与 approve-button 共享 actions/pr-review.mjs，差异：
 *   - review event = REQUEST_CHANGES（而非 APPROVE）
 *   - audit comment action 标签 = request_changes
 */
import { executePrReview } from '../actions/pr-review.mjs';
import { parseTargetFromValue } from './approve-button.mjs';

export const REQUEST_CHANGES_BTN_TAG = 'request_changes_btn';

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
