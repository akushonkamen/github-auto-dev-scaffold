/**
 * Step 10 — Optional Notion mirror.
 */
import { confirm, input, password } from '@inquirer/prompts';
import { gh } from '../shell.mjs';
import { validateNotionDatabaseId, validateNotionKey } from '../validators.mjs';

export const id = '10-optional-notion';
export const title = 'Notion mirror (optional)';

export async function run(ctx) {
  const { preview, targetRepo, dry } = ctx;

  const want = await confirm({ message: 'Configure Notion Issue mirror?', default: false });
  if (!want) {
    preview.info('skipped.');
    return { status: 'skipped' };
  }

  const keyInput = await password({ message: 'NOTION_API_KEY (secret_ or ntn_ prefix):', mask: '*' });
  const kv = validateNotionKey(keyInput);
  if (!kv.ok) {
    preview.error(kv.error);
    return { status: 'failed' };
  }
  const dbIdInput = await input({
    message: 'NOTION_DATABASE_ID (32 hex, dashes optional):',
    validate: (s) => validateNotionDatabaseId(s).ok || validateNotionDatabaseId(s).error,
  });
  const dv = validateNotionDatabaseId(dbIdInput);

  preview.info('Probing Notion database...');
  const probe = await probeDatabase(kv.value, dv.value);
  if (!probe.ok) {
    preview.error(`probe failed: ${probe.error}`);
    preview.info('See docs/notion-integration.md for required properties.');
    return { status: 'failed' };
  }
  preview.notice('notion database reachable.');

  if (dry) {
    preview.warn('(dry-run) skipping writes');
    return { status: 'dry' };
  }

  await gh(['secret', 'set', 'NOTION_API_KEY', '--repo', targetRepo, '--body', kv.value], {
    mask: [kv.value], silent: true,
  });
  await gh(['variable', 'set', 'NOTION_DATABASE_ID', '--repo', targetRepo, '--body', dv.value], { silent: true });
  ctx._secrets = ctx._secrets || {};
  ctx._secrets.NOTION_API_KEY = kv.value;
  preview.notice('NOTION_API_KEY + NOTION_DATABASE_ID written.');
  preview.info('Remember to create 9 properties — see docs/notion-integration.md.');
  return { status: 'ok' };
}

async function probeDatabase(key, dbId) {
  try {
    const res = await fetch(`https://api.notion.com/v1/databases/${dbId.replace(/-/g, '')}`, {
      headers: {
        authorization: `Bearer ${key}`,
        'notion-version': '2022-06-28',
      },
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { ok: false, error: `HTTP ${res.status} ${t.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
