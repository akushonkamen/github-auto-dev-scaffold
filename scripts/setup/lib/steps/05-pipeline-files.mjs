/**
 * Step 5 — Pipeline files deployment.
 * Skipped when target == current repo (self-hosted dogfood).
 * Otherwise: show copy plan and prompt for project metadata → render CLAUDE.md.
 */
import { checkbox, confirm, input } from '@inquirer/prompts';

export const id = '05-pipeline-files';
export const title = 'Pipeline files deployment';

const COPY_PATHS = ['.github', 'docs', 'CLAUDE.md', 'README.md', 'scripts'];

export async function run(ctx) {
  const { preview, state, dry } = ctx;

  if (state.isSelfHosted) {
    preview.notice('target == current repo — skipping file copy.');
    return { status: 'skipped' };
  }

  const selected = await checkbox({
    message: 'Paths to copy to target repo:',
    choices: COPY_PATHS.map((p) => ({
      name: p,
      value: p,
      checked: true,
      disabled: p === '.github' || p === 'docs',
    })),
  });
  if (!selected.length) {
    preview.warn('nothing selected.');
    return { status: 'skipped' };
  }

  const projectName = await input({ message: 'Project name (for CLAUDE.md):' });
  const oneLiner = await input({ message: 'One-line description:' });
  const srcTree = await input({
    message: 'Source tree directory (e.g. src/ or app/, blank if none):',
    default: '',
  });

  preview.info(`Will render CLAUDE.md for "${projectName}" and copy ${selected.join(', ')}.`);
  preview.warn('File deployment requires: clone target → rsync → commit → push to dev branch.');
  preview.warn('S7 dogfooding: this direct push is itself a pipeline-fix action; audit-comment required.');

  const method = await confirm({
    message: 'Proceed with file deployment now? (clones to /tmp)',
    default: false,
  });
  if (!method) {
    preview.info('Skipped — copy files manually.');
    return { status: 'skipped' };
  }

  if (dry) {
    preview.warn('(dry-run) skipping actual deployment.');
    return { status: 'dry' };
  }

  // The actual copy is intentionally NOT implemented here — it is a high-risk
  // destructive operation that should be done with care. We surface the plan
  // and prompt the user to execute via a follow-up Issue → PR pipeline on the
  // target repo (the wizard is meant to bootstrap, not bypass).
  preview.warn('Automated deployment is out-of-scope for v0.1.');
  preview.info('Manual steps:');
  preview.info('  1. git clone <target>');
  preview.info('  2. cp -R .github docs CLAUDE.md <target>/');
  preview.info('  3. edit CLAUDE.md to set project metadata');
  preview.info('  4. git checkout -b chore/pipeline-bootstrap');
  preview.info('  5. git add . && git commit -m "chore: bootstrap pipeline (wizard)"');
  preview.info('  6. gh pr create --base dev');
  state.pendingManualDeploy = true;
  return { status: 'skipped' };
}
