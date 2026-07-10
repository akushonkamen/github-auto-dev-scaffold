/**
 * Step 2 — Base branch selection.
 * AI code never lands on main/master (S3). Default: dev.
 */
import { input, select } from '@inquirer/prompts';
import { ghBranchExists } from '../shell.mjs';
import { isForbiddenBaseBranch, validateBranchName } from '../validators.mjs';

export const id = '02-base-branch';
export const title = 'Base branch';

export async function run(ctx) {
  const { preview, state, targetRepo } = ctx;
  const candidates = ['dev', 'develop'];
  if (state.defaultBranch && !candidates.includes(state.defaultBranch)) {
    candidates.unshift(state.defaultBranch);
  }

  const choice = await select({
    message: 'Base branch for AI-generated PRs (S3: never main/master):',
    choices: [
      ...candidates.map((b) => ({ name: b, value: b })),
      { name: 'custom…', value: '__custom__' },
    ],
  });

  let branch = choice;
  if (choice === '__custom__') {
    branch = await input({
      message: 'Custom base branch name:',
      validate: (s) => validateBranchName(s).ok || validateBranchName(s).error,
    });
  }

  const v = validateBranchName(branch);
  if (!v.ok) {
    preview.error(v.error);
    return { status: 'failed' };
  }
  if (isForbiddenBaseBranch(v.value)) {
    preview.error('S3 violation: AI code cannot land on main/master.');
    return { status: 'failed' };
  }

  const exists = await ghBranchExists(targetRepo, v.value);
  if (!exists) {
    preview.warn(`branch "${v.value}" does not exist on ${targetRepo}.`);
    preview.info(`Create it yourself first:  git checkout main && git push origin HEAD:${v.value}`);
    return { status: 'skipped' };
  }

  preview.notice(`base branch: ${v.value}`);
  ctx.baseBranch = v.value;
  state.baseBranch = v.value;
  return { status: 'ok' };
}
