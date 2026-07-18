/**
 * Lazy loader for @inquirer/prompts.
 *
 * Why lazy: the interactive prompt library is an optional runtime dependency
 * of the setup wizard — it is only needed when the wizard runs interactively.
 * But several step modules also export pure helpers (renderCodeowners,
 * parseLabelsYml, …) that the test suite imports directly under
 * `node --test`. Module 6 runs those tests without `npm install`, so a
 * top-level `import … from '@inquirer/prompts'` makes the whole step module
 * unimportable (ERR_MODULE_NOT_FOUND) and fails tests that only exercise the
 * pure helpers.
 *
 * Deferring the load to the first prompt call keeps every step module
 * importable without the dependency installed, while preserving identical
 * prompt behavior when node_modules IS present. Step modules import these
 * re-exports instead of '@inquirer/prompts' directly.
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
