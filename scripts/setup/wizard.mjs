#!/usr/bin/env node
/**
 * setup-wizard entry point.
 *
 * Usage:
 *   node wizard.mjs [--dry-run] [--from-step=N] [--no-state]
 *
 * Walks the user through 12 steps (preflight → smoke-test), persists state
 * to .wizard-state.json, and NEVER writes secrets to disk. Each step has
 * its own confirm prompt; --dry-run previews commands without executing.
 */
import { ensureGitignored, loadState, markStepComplete, saveState, statePath } from './lib/state.mjs';
import { banner, color, commandList, error, info, notice, summary, warn } from './lib/preview.mjs';

import * as step00 from './lib/steps/00-preflight.mjs';
import * as step01 from './lib/steps/01-target-repo.mjs';
import * as step02 from './lib/steps/02-base-branch.mjs';
import * as step03 from './lib/steps/03-llm-provider.mjs';
import * as step04 from './lib/steps/04-pat.mjs';
import * as step05 from './lib/steps/05-pipeline-files.mjs';
import * as step06 from './lib/steps/06-repo-vars.mjs';
import * as step07 from './lib/steps/07-labels.mjs';
import * as step08 from './lib/steps/08-codeowners.mjs';
import * as step09 from './lib/steps/09-branch-protection.mjs';
import * as step10 from './lib/steps/10-optional-notion.mjs';
import * as step11 from './lib/steps/11-smoke-test.mjs';

const STEPS = [step00, step01, step02, step03, step04, step05, step06, step07, step08, step09, step10, step11];

const args = parseArgs(process.argv.slice(2));

if (!args['no-state']) ensureGitignored();

const state = args['no-state'] ? { completedSteps: {} } : loadState();
const ctx = {
  state,
  dry: !!args['dry-run'],
  preview: { banner, info, notice, warn, error, commandList },
};

const startIdx = args['from-step'] ? Math.max(0, Number(args['from-step'])) : 0;
if (startIdx >= STEPS.length) {
  error(`--from-step=${startIdx} out of range (max ${STEPS.length - 1})`);
  process.exit(2);
}

console.log(color('\x1b[1m\x1b[36m', `Setup wizard — ${args['dry-run'] ? 'DRY-RUN' : 'LIVE'} mode`));
if (!args['no-state']) console.log(color('\x1b[2m', `  state: ${statePath()}`));

const done = [];
for (let i = startIdx; i < STEPS.length; i++) {
  const step = STEPS[i];
  banner(STEPS.length, i + 1, step.title);
  const alreadyDone = !args['no-state'] && state.completedSteps[step.id];
  if (alreadyDone && !args['dry-run']) {
    info(`already complete — skipping (re-run with --from-step=${i} --no-state to force)`);
    done.push({ step: step.id, title: step.title, status: 'skipped' });
    continue;
  }
  try {
    const r = await step.run(ctx);
    const status = r.status === 'ok' ? 'ok' : r.status === 'skipped' ? 'skipped' : r.status === 'dry' ? 'dry' : 'failed';
    done.push({ step: step.id, title: step.title, status });
    if (status === 'ok' && !args['no-state']) {
      markStepComplete(state, step.id, { at: new Date().toISOString() });
    }
    if (status === 'failed') {
      warn(`Step ${step.id} failed. Use --from-step=${i} to retry after fixing.`);
      break;
    }
  } catch (err) {
    error(`step ${step.id} threw: ${err.message}`);
    if (err.wizardCommand) info(`  command: ${err.wizardCommand}`);
    done.push({ step: step.id, title: step.title, status: 'failed' });
    break;
  }
}

if (!args['no-state'] && done.every((d) => d.status === 'ok' || d.status === 'skipped' || d.status === 'dry')) {
  state.finishedAt = new Date().toISOString();
  saveState(state);
}

summary(done);

if (ctx.artifacts) {
  console.log(color('\x1b[1m', '\nArtifacts (commit via Issue → PR pipeline):'));
  for (const [k, v] of Object.entries(ctx.artifacts)) {
    console.log(color('\x1b[2m', `  — ${k}`));
    console.log(v.split('\n').map((l) => `    ${l}`).join('\n'));
  }
}

// Zero out secret memory before exit
for (const k of Object.keys(ctx._secrets || {})) ctx._secrets[k] = null;

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    if (a === '--dry-run') out['dry-run'] = true;
    else if (a === '--no-state') out['no-state'] = true;
    else if (a.startsWith('--from-step=')) out['from-step'] = Number(a.split('=')[1]);
    else if (a === '-h' || a === '--help') {
      console.log('Usage: node wizard.mjs [--dry-run] [--from-step=N] [--no-state]');
      process.exit(0);
    }
  }
  return out;
}
