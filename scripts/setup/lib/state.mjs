/**
 * Wizard state persistence.
 *
 * Saves non-secret state to .wizard-state.json (gitignored) so re-runs can skip
 * completed steps via --from-step=N. Secrets are NEVER written to disk —
 * they live only in process memory and are sent straight to `gh secret set`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Resolved lazily so WIZARD_STATE_PATH can be set after module load (used by
// integration tests to redirect state to a sandbox).
function resolveStatePath() {
  return process.env.WIZARD_STATE_PATH
    ? process.env.WIZARD_STATE_PATH
    : join(__dirname, '..', '.wizard-state.json');
}

const DEFAULT_STATE = {
  version: 1,
  startedAt: null,
  finishedAt: null,
  completedSteps: {}, // { "01-target-repo": { repo: "...", ... } }
  currentStep: null,
};

export function loadState() {
  const STATE_PATH = resolveStatePath();
  if (!existsSync(STATE_PATH)) return { ...DEFAULT_STATE, startedAt: new Date().toISOString() };
  try {
    const raw = readFileSync(STATE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed.version !== 1) {
      throw new Error(`unsupported wizard-state version: ${parsed.version}`);
    }
    return { ...DEFAULT_STATE, ...parsed };
  } catch (err) {
    throw new Error(`could not parse ${STATE_PATH}: ${err.message}`);
  }
}

export function saveState(state) {
  const STATE_PATH = resolveStatePath();
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}

export function markStepComplete(state, stepId, payload = {}) {
  state.completedSteps[stepId] = { at: new Date().toISOString(), ...payload };
  saveState(state);
}

export function clearState() {
  const STATE_PATH = resolveStatePath();
  if (existsSync(STATE_PATH)) {
    writeFileSync(STATE_PATH, '');
  }
}

export function statePath() {
  return resolveStatePath();
}

/**
 * Read .gitignore and add the wizard state file path if missing.
 * Idempotent — safe to call repeatedly.
 */
export function ensureGitignored() {
  const repoRoot = findRepoRoot();
  if (!repoRoot) return false;
  const ignorePath = join(repoRoot, '.gitignore');
  const entry = 'scripts/setup/.wizard-state.json';
  let content = '';
  if (existsSync(ignorePath)) {
    content = readFileSync(ignorePath, 'utf-8');
    if (content.split('\n').some((l) => l.trim() === entry)) {
      return true;
    }
  }
  const addition = (content && !content.endsWith('\n') ? '\n' : '') + `\n# setup wizard state — may contain target repo name, never secrets\n${entry}\n`;
  writeFileSync(ignorePath, content + addition);
  return true;
}

function findRepoRoot() {
  // Walk from process.cwd() first — if the user runs the wizard from inside
  // a target repo clone, we want THAT repo's .gitignore, not the wizard's.
  for (const start of [process.cwd(), __dirname]) {
    let d = start;
    while (d !== '/' && !existsSync(join(d, '.git'))) {
      d = dirname(d);
    }
    if (d !== '/') return d;
  }
  return null;
}
