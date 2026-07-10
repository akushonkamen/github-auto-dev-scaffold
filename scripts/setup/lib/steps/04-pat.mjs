/**
 * Step 4 — CLAUDE_DEV_PAT (S6).
 * Fine-grained PAT only, single-repo scope, validated via /user endpoint.
 */
import { confirm, password } from '@inquirer/prompts';
import { gh } from '../shell.mjs';
import { maskSecret, validatePAT } from '../validators.mjs';

export const id = '04-pat';
export const title = 'CLAUDE_DEV_PAT (S6)';

const TOKEN_DOCS_URL = 'https://github.com/settings/personal-access-tokens/new';

export async function run(ctx) {
  const { preview, state, targetRepo, dry } = ctx;

  preview.info('S6 red line: fine-grained PAT, single-repo scope, ≤90 days, minimal perms.');
  preview.info(`Create one at ${TOKEN_DOCS_URL}`);
  preview.info('Required permissions: issues:write, pull-requests:write, contents:write, metadata:read');

  const token = await password({
    message: 'Paste fine-grained PAT (github_pat_* — input masked):',
    mask: '*',
  });
  const v = validatePAT(token);
  if (!v.ok) {
    preview.error(v.error);
    return { status: 'failed' };
  }

  preview.info('Validating PAT against api.github.com/user ...');
  const probe = await probePat(token);
  if (!probe.ok) {
    preview.error(`PAT probe failed: ${probe.error}`);
    return { status: 'failed' };
  }
  preview.notice(`PAT identity: ${probe.login}`);

  const cmd = ['secret', 'set', 'CLAUDE_DEV_PAT', '--repo', targetRepo];
  preview.commandList([{ cmd: 'gh', args: cmd, mask: token }]);
  if (dry) {
    preview.warn('(dry-run) skipping secret set');
  } else {
    const ok = await confirm({
      message: `Write CLAUDE_DEV_PAT to ${targetRepo}?`,
      default: true,
    });
    if (!ok) return { status: 'skipped' };
    await gh([...cmd, '--body', token], { mask: [token], silent: true });
    preview.notice('secret written.');
  }

  ctx._secrets = ctx._secrets || {};
  ctx._secrets.CLAUDE_DEV_PAT = token;
  state.patOwner = probe.login;
  preview.info(`masked: ${maskSecret(token)}`);
  return { status: 'ok' };
}

async function probePat(token) {
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'user-agent': 'githubauto-dev-setup-wizard',
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `HTTP ${res.status} ${text.slice(0, 200)}` };
    }
    const j = await res.json();
    return { ok: true, login: j.login };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
