/**
 * Step 7 — Labels sync.
 * Reads .github/labels.yml, diffs against remote, applies via `gh label create --force`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { confirm } from '@inquirer/prompts';
import { gh, run as runCmd } from '../shell.mjs';

export const id = '07-labels';
export const title = 'Labels sync';

const __dirname = dirname(fileURLToPath(import.meta.url));
// scripts/setup/lib/steps/ → up 4 to repo root
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const LABELS_YML = join(REPO_ROOT, '.github', 'labels.yml');

export async function run(ctx) {
  const { preview, targetRepo, dry } = ctx;

  if (!existsSync(LABELS_YML)) {
    preview.warn(`no .github/labels.yml at ${LABELS_YML} — skipping.`);
    return { status: 'skipped' };
  }
  const local = parseLabelsYml(readFileSync(LABELS_YML, 'utf-8'));
  preview.info(`parsed ${local.length} labels from .github/labels.yml`);

  const remote = await listRemoteLabels(targetRepo);
  const remoteNames = new Set(remote.map((l) => l.name));
  const plan = { add: [], update: [], same: [] };
  for (const l of local) {
    const r = remote.find((x) => x.name === l.name);
    if (!r) plan.add.push(l);
    else if (r.color !== l.color || (r.description || '') !== (l.description || ''))
      plan.update.push(l);
    else plan.same.push(l);
  }
  preview.info(`plan: +${plan.add.length} add, ~${plan.update.length} update, =${plan.same.length} same`);

  const todo = [...plan.add, ...plan.update];
  if (!todo.length) {
    preview.notice('labels already in sync.');
    return { status: 'ok' };
  }

  const commands = todo.map((l) => ({
    cmd: 'gh',
    args: ['label', 'create', l.name, '--color', l.color, '--description', l.description, '--repo', targetRepo, '--force'],
  }));
  preview.commandList(commands);

  if (dry) {
    preview.warn('(dry-run) skipping label writes');
    return { status: 'dry' };
  }
  const ok = await confirm({ message: `Sync ${todo.length} labels?`, default: true });
  if (!ok) return { status: 'skipped' };

  for (const l of todo) {
    await gh([
      'label', 'create', l.name,
      '--color', l.color,
      '--description', l.description,
      '--repo', targetRepo,
      '--force',
    ], { silent: true });
  }
  preview.notice(`${todo.length} labels synced.`);
  return { status: 'ok' };
}

async function listRemoteLabels(repo) {
  try {
    const { stdout } = await runCmd('gh', ['label', 'list', '--repo', repo, '--json', 'name,color,description', '--limit', '200']);
    return JSON.parse(stdout);
  } catch {
    return [];
  }
}

/**
 * Parse a labels.yml of form:
 *   - name: triage
 *     color: fbca04
 *     description: "module 2"
 * Returns [{name,color,description}]. Color is normalized to no leading '#'.
 */
export function parseLabelsYml(text) {
  const out = [];
  let cur = null;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\s+$/, '');
    if (/^\s*-\s+name:\s*(.*)$/.test(line)) {
      if (cur) out.push(cur);
      cur = { name: strip(line.replace(/^\s*-\s+name:\s*/, '')), color: '', description: '' };
    } else if (cur && /^\s+color:\s*(.*)$/.test(line)) {
      cur.color = strip(line.replace(/^\s+color:\s*/, '')).replace(/^#/, '');
    } else if (cur && /^\s+description:\s*(.*)$/.test(line)) {
      cur.description = strip(line.replace(/^\s+description:\s*/, ''));
    } else if (/^\s*$/.test(line) || /^\s*#/.test(line)) {
      continue;
    }
  }
  if (cur) out.push(cur);
  return out.filter((l) => l.name);
}

function strip(s) {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}
