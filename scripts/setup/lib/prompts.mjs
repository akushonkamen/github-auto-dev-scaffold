/**
 * Lazy loader for @inquirer/prompts.
 *
 * Why this exists: 03-llm-provider.mjs is imported directly by
 * scripts/setup/test/rename-guard.test.mjs, which Issue #141 mandates must run
 * under `node --test` WITHOUT `npm install`. A top-level
 * `import … from '@inquirer/prompts'` in 03 would make the module unimportable
 * (ERR_MODULE_NOT_FOUND) with no node_modules and fail that test before any
 * assertion runs. Deferring the load to the first prompt call keeps 03
 * importable without the dependency, while preserving identical prompt
 * behavior when node_modules IS present.
 *
 * Only 03 routes through here — it is the sole step module imported by a
 * no-install test. The other steps are loaded only interactively (wizard.mjs,
 * always run with deps installed) or by tests that run under `npm ci`, so
 * their direct '@inquirer/prompts' import is fine and is left untouched.
 */
let pending;
function lib() {
  pending = pending || import('@inquirer/prompts');
  return pending;
}

export function confirm(opts) { return lib().then((m) => m.confirm(opts)); }
export function input(opts) { return lib().then((m) => m.input(opts)); }
export function select(opts) { return lib().then((m) => m.select(opts)); }
export function password(opts) { return lib().then((m) => m.password(opts)); }
export function checkbox(opts) { return lib().then((m) => m.checkbox(opts)); }
