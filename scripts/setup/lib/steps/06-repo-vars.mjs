/**
 * Step 6 — Repo vars (24).
 * Groups pipeline repo variables into batches, prompts with defaults,
 * previews `gh variable set` commands, executes after confirm.
 */
import { confirm, input } from '@inquirer/prompts';
import { gh } from '../shell.mjs';
import { validateModelId, validatePositiveInt } from '../validators.mjs';

export const id = '06-repo-vars';
export const title = 'Repo variables';

export async function run(ctx) {
  const { preview, state, targetRepo, dry, llm } = ctx;
  if (!llm) {
    preview.error('LLM provider not configured — run Step 3 first.');
    return { status: 'failed' };
  }

  const groups = buildGroups({ llm, baseBranch: state.baseBranch, patOwner: state.patOwner });

  for (const g of groups) {
    preview.info(`group: ${g.label}`);
    for (const v of g.vars) {
      const validator = v.kind === 'int' ? validatePositiveInt : v.kind === 'model' ? validateModelId : null;
      if (validator) {
        const next = await input({
          message: `${v.name}:`,
          default: String(v.default),
          validate: (s) => validator(s).ok || validator(s).error,
        });
        const r = validator(next);
        v.value = r.ok ? r.value : v.default;
      } else {
        v.value = v.default;
      }
    }
  }

  const flat = groups.flatMap((g) => g.vars);
  const commands = flat.map((v) => ({
    cmd: 'gh',
    args: ['variable', 'set', v.name, '--repo', targetRepo, '--body', String(v.value)],
  }));
  preview.commandList(commands);

  if (dry) {
    preview.warn('(dry-run) skipping variable set');
    return { status: 'dry' };
  }
  const ok = await confirm({ message: `Write ${flat.length} variables?`, default: true });
  if (!ok) return { status: 'skipped' };

  for (const v of flat) {
    await gh(['variable', 'set', v.name, '--repo', targetRepo, '--body', String(v.value)], { silent: true });
  }
  preview.notice(`${flat.length} variables written.`);
  return { status: 'ok' };
}

function buildGroups({ llm, baseBranch, patOwner }) {
  const baseUrlDefault = llm.baseUrl || '';
  const modelDefault = llm.model || 'deepseek-v4-pro';

  return [
    {
      label: 'engine core',
      vars: [
        { name: 'ANTHROPIC_BASE_URL', default: baseUrlDefault, kind: 'str' },
        { name: 'TRIAGE_MODEL', default: modelDefault, kind: 'model' },
        { name: 'DEVELOP_MODEL', default: modelDefault, kind: 'model' },
        { name: 'SELF_VERIFY_MODEL', default: modelDefault, kind: 'model' },
        { name: 'TEST_MODEL', default: modelDefault, kind: 'model' },
        { name: 'REVIEW_MODEL', default: modelDefault, kind: 'model' },
      ],
    },
    {
      label: 'turn budgets',
      vars: [
        { name: 'DEVELOP_MAX_TURNS', default: 20, kind: 'int' },
        { name: 'SELF_VERIFY_MAX_TURNS', default: 10, kind: 'int' },
        { name: 'TEST_MAX_TURNS', default: 10, kind: 'int' },
        { name: 'REVIEW_MAX_TURNS', default: 12, kind: 'int' },
      ],
    },
    {
      label: 'time budgets',
      vars: [
        { name: 'DEVELOP_TIME_BUDGET_MIN', default: 60, kind: 'int' },
        { name: 'TEST_TIME_BUDGET_MIN', default: 30, kind: 'int' },
        { name: 'REVIEW_TIME_BUDGET_MIN', default: 20, kind: 'int' },
        { name: 'CLARIFY_TIME_BUDGET_MIN', default: 30, kind: 'int' },
      ],
    },
    {
      label: 'retry / clarify',
      vars: [
        { name: 'CLARIFY_MAX_ROUNDS', default: 3, kind: 'int' },
        { name: 'TEST_RETRY_MAX', default: 3, kind: 'int' },
      ],
    },
    {
      label: 'repo meta',
      vars: [
        { name: 'DEV_BASE_BRANCH', default: baseBranch || 'dev', kind: 'str' },
        { name: 'CLAUDE_DEV_PAT_OWNER', default: patOwner || '', kind: 'str' },
      ],
    },
  ];
}
