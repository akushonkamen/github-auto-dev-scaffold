/**
 * Step 1 — Target repo connection.
 * Prompts for owner/name (default = current origin remote), validates via gh.
 */
import { confirm, input } from '@inquirer/prompts';
import { detectCurrentRepo, ghRepoInfo } from '../shell.mjs';
import { validateRepo } from '../validators.mjs';

export const id = '01-target-repo';
export const title = 'Target repo connection';

export async function run(ctx) {
  const { preview, state, dry } = ctx;
  const detected = await detectCurrentRepo();
  const defaultRepo = detected || '';

  const answer = await input({
    message: 'Target repo (owner/name):',
    default: defaultRepo,
    validate: (s) => validateRepo(s).ok || validateRepo(s).error,
  });
  const v = validateRepo(answer);
  if (!v.ok) {
    preview.error(v.error);
    return { status: 'failed' };
  }
  const repo = v.value;

  preview.info(`Validating ${repo} via gh...`);
  const info = await ghRepoInfo(repo);
  if (!info.ok) {
    preview.error(`cannot read repo: ${info.error}`);
    preview.info('Possible causes: repo does not exist / gh lacks scope / no admin permission.');
    return { status: 'failed' };
  }
  if (!['ADMIN', 'MAINTAINER'].includes(info.viewerPermission)) {
    preview.warn(`viewer permission is ${info.viewerPermission} — write steps will likely fail.`);
  } else {
    preview.notice(`permission: ${info.viewerPermission}`);
  }

  ctx.targetRepo = info.repo;
  ctx.defaultBranch = info.defaultBranch;
  ctx.isSelfHosted = detected === info.repo;

  preview.info(`default branch: ${info.defaultBranch}`);
  if (dry) preview.warn('(dry-run) no writes will occur');

  const ok = dry ? true : await confirm({
    message: `Proceed with target ${info.repo}?`,
    default: true,
  });
  if (!ok) return { status: 'skipped' };

  state.targetRepo = info.repo;
  state.defaultBranch = info.defaultBranch;
  state.isSelfHosted = ctx.isSelfHosted;
  return { status: 'ok' };
}
