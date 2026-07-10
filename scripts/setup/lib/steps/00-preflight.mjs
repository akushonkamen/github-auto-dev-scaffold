/**
 * Step 0 — Pre-flight checks.
 * Verifies gh auth, node >=20, git installed, and whether cwd is a git repo.
 */
import { ghAuthCheck, run as runCmd } from '../shell.mjs';

export const id = '00-preflight';
export const title = 'Pre-flight checks';

export async function run(ctx) {
  const { preview } = ctx;
  preview.info('Checking environment...');

  const problems = [];

  const nodeVer = await checkNode();
  if (!nodeVer.ok) problems.push(nodeVer.error);
  else preview.notice(`node ${nodeVer.version}`);

  const gitVer = await checkGit();
  if (!gitVer.ok) problems.push(gitVer.error);
  else preview.notice(`git ${gitVer.version}`);

  const auth = await ghAuthCheck();
  if (!auth.ok) {
    problems.push(`gh not authenticated — run \`gh auth login\` first (got: ${auth.error})`);
  } else {
    preview.notice(`gh authenticated as ${auth.account}`);
    ctx.ghAccount = auth.account;
  }

  if (problems.length) {
    preview.error('Pre-flight failed:');
    for (const p of problems) preview.error(`  - ${p}`);
    return { status: 'failed' };
  }
  return { status: 'ok' };
}

async function checkNode() {
  try {
    const { stdout } = await runCmd('node', ['--version']);
    const v = stdout.trim().replace(/^v/, '');
    const major = Number(v.split('.')[0]);
    if (!Number.isInteger(major) || major < 20) {
      return { ok: false, error: `node >=20 required (got ${v})` };
    }
    return { ok: true, version: v };
  } catch (err) {
    return { ok: false, error: 'node not found' };
  }
}

async function checkGit() {
  try {
    const { stdout } = await runCmd('git', ['--version']);
    return { ok: true, version: stdout.trim().replace(/^git version /, '') };
  } catch {
    return { ok: false, error: 'git not found' };
  }
}
