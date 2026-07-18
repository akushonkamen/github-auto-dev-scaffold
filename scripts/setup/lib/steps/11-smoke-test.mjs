/**
 * Step 11 — Smoke test.
 * Opens a test issue, waits for triage workflow, reports the run URL.
 */
import { confirm } from '../prompts.mjs';
import { gh, run as runCmd } from '../shell.mjs';

export const id = '11-smoke-test';
export const title = 'Smoke test';

export async function run(ctx) {
  const { preview, targetRepo, dry } = ctx;
  const want = await confirm({ message: 'Open a test issue to verify pipeline?', default: false });
  if (!want) {
    preview.info('skipped.');
    return { status: 'skipped' };
  }

  const title = `[smoke-test] wizard verification ${new Date().toISOString().slice(0, 19)}Z`;
  const body = '### what\n\nwizard smoke test — please triage and close.\n\n### context\n\nCreated by `scripts/setup/wizard.mjs`.';

  if (dry) {
    preview.warn('(dry-run) skipping issue create');
    return { status: 'dry' };
  }

  const { stdout } = await gh([
    'issue', 'create', '--repo', targetRepo,
    '--title', title, '--body', body,
    '--label', 'triage',
  ], { silent: true });
  const issueUrl = stdout.trim();
  preview.notice(`opened: ${issueUrl}`);

  // Poll for triage workflow start (up to 3 min) instead of fixed sleep.
  preview.info('Waiting for triage workflow to start (polling up to 3 min)...');
  let runUrl = null;
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    await sleep(10_000);
    try {
      const { stdout: j } = await runCmd('gh', ['run', 'list', '--repo', targetRepo, '--workflow', 'triage-issue.yml', '--limit', '1', '--json', 'databaseId,status,conclusion,htmlUrl']);
      const arr = JSON.parse(j);
      if (arr.length && arr[0].status && arr[0].status !== 'queued') {
        const r = arr[0];
        runUrl = r.htmlUrl;
        preview.notice(`triage run visible: ${r.htmlUrl} (${r.status}/${r.conclusion || '-'})`);
        break;
      }
    } catch (err) {
      preview.warn(`poll error (will retry): ${err.message}`);
    }
  }
  if (!runUrl) {
    preview.warn('no triage run found in 3 min — check Actions tab manually.');
    preview.info(`  https://github.com/${targetRepo}/actions/workflows/triage-issue.yml`);
  }
  return { status: 'ok' };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
