/**
 * Preview helpers — render "will run" command lists for dry-run mode + per-step
 * confirmation prompts. Pure formatting, no I/O.
 */

const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

export function color(code, s) {
  return `${code}${s}${RESET}`;
}

export function banner(total, idx, title) {
  const bar = '─'.repeat(60);
  console.log('');
  console.log(color(BOLD + CYAN, `╭${bar}╮`));
  const line = `│ [step ${idx}/${total}] ${title}`;
  const pad = ' '.repeat(Math.max(0, 62 - line.length - 1));
  console.log(color(BOLD + CYAN, line + pad + '│'));
  console.log(color(BOLD + CYAN, `╰${bar}╯`));
}

export function info(msg) {
  console.log(color(DIM, `  ℹ ${msg}`));
}

export function notice(msg) {
  console.log(color(GREEN, `  ✓ ${msg}`));
}

export function warn(msg) {
  console.log(color(YELLOW, `  ⚠ ${msg}`));
}

export function error(msg) {
  console.error(color(RED, `  ✗ ${msg}`));
}

/**
 * Render a list of commands that would be run, indented.
 * Each entry: string, or { cmd, args, mask? }.
 */
export function commandList(commands) {
  console.log(color(DIM, '  Commands that will run:'));
  for (const c of commands) {
    if (typeof c === 'string') {
      console.log(`    ${color(DIM, '$')} ${c}`);
    } else {
      const argStr = (c.args || []).join(' ');
      const masked = c.mask ? argStr.replaceAll(c.mask, '***') : argStr;
      console.log(`    ${color(DIM, '$')} ${c.cmd} ${masked}`);
    }
  }
}

/**
 * Print the final summary report. `done` is an array of { step, title, status }
 * where status ∈ { 'ok', 'skipped', 'failed', 'dry' }.
 */
export function summary(done) {
  console.log('');
  console.log(color(BOLD, 'Setup wizard — summary'));
  console.log(color(DIM, '─'.repeat(60)));
  for (const d of done) {
    const icon = {
      ok: color(GREEN, '✓'),
      skipped: color(YELLOW, '↷'),
      failed: color(RED, '✗'),
      dry: color(DIM, '○'),
    }[d.status] || '?';
    const tag = d.status === 'skipped' ? color(DIM, ' (skipped)') : '';
    console.log(`  ${icon} [${d.step}] ${d.title}${tag}`);
  }
  console.log(color(DIM, '─'.repeat(60)));
  const failed = done.filter((d) => d.status === 'failed');
  const skipped = done.filter((d) => d.status === 'skipped');
  if (failed.length) {
    console.log(color(RED, `  ${failed.length} step(s) failed — see log above for remediation.`));
  }
  if (skipped.length) {
    console.log(color(YELLOW, `  ${skipped.length} step(s) skipped — re-run wizard to retry.`));
  }
  if (!failed.length && !skipped.length) {
    console.log(color(GREEN, '  All steps complete. Pipeline is ready.'));
  }
}
