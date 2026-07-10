/**
 * Promisified shell helpers used by every step. Centralises:
 *   - exec (capture stdout/stderr)
 *   - gh (gh CLI wrapper with --json where helpful)
 *   - git
 *   - dry-run aware: callers pass `dry` flag, we print the command instead of running
 *
 * We deliberately avoid spawning shells (`execFile` not `exec`) to avoid quote-injection
 * bugs when commands include user-supplied repo names or branch names.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const pExecFile = promisify(execFile);

/**
 * Run a command, return { stdout, stderr, exit }. Throws on non-zero exit.
 */
export async function run(cmd, args, opts = {}) {
  const { stdout, stderr } = await pExecFile(cmd, args, {
    maxBuffer: 10 * 1024 * 1024,
    ...opts,
  });
  return { stdout: stdout.toString(), stderr: stderr.toString() };
}

/**
 * Dry-run aware command executor.
 *   - dry=true  → print "[dry] cmd args..." to stdout, return { stdout: '', stderr: '', dry: true }
 *   - dry=false → actually run
 *   - mask      → optional array of strings to mask in the printed command (for secrets)
 */
export async function maybeRun(cmd, args, { dry = false, mask = [], silent = false } = {}) {
  const display = maskArgs(cmd, args, mask);
  if (!silent) console.log(`  $ ${display}`);
  if (dry) return { stdout: '', stderr: '', dry: true };
  try {
    const res = await run(cmd, args);
    return { ...res, dry: false };
  } catch (err) {
    // Attach the rendered command for clearer error reporting upstream.
    err.wizardCommand = display;
    throw err;
  }
}

function maskArgs(cmd, args, mask) {
  if (!mask.length) return `${cmd} ${args.map(shellQuote).join(' ')}`;
  const maskedArgs = args.map((a) =>
    mask.some((m) => typeof m === 'string' && m.length > 0 && a.includes(m)) ? '***' : a,
  );
  return `${cmd} ${maskedArgs.map(shellQuote).join(' ')}`;
}

export function shellQuote(s) {
  if (typeof s !== 'string') return String(s);
  if (s === '') return "''";
  // Only allow safe subset of chars without quoting
  if (/^[A-Za-z0-9_./@:=,-]+$/.test(s)) return s;
  // Escape single quotes
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** gh wrapper — convenience. */
export async function gh(args, opts = {}) {
  return maybeRun('gh', args, opts);
}

/** git wrapper — convenience. */
export async function git(args, opts = {}) {
  return maybeRun('git', args, opts);
}

/**
 * Read the current repo's origin remote as owner/name, or null if not a git repo
 * or no origin. Used as the default for the "target repo" prompt.
 */
export async function detectCurrentRepo() {
  try {
    const { stdout } = await run('git', ['remote', 'get-url', 'origin']);
    const url = stdout.trim();
    return parseRemoteUrl(url);
  } catch {
    return null;
  }
}

export function parseRemoteUrl(url) {
  if (!url) return null;
  // git@github.com:owner/repo.git
  let m = url.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
  if (m) return `${m[1]}/${m[2]}`;
  // https://github.com/owner/repo(.git)
  m = url.match(/^https?:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/);
  if (m) return `${m[1]}/${m[2]}`;
  return null;
}

/**
 * Check gh auth status. Returns { ok, account } or { ok: false, error }.
 */
export async function ghAuthCheck() {
  try {
    const { stdout } = await run('gh', ['auth', 'status', '--show-token']);
    const m = stdout.match(/account ([A-Za-z0-9_-]+)/i);
    return { ok: true, account: m ? m[1] : '(unknown)' };
  } catch (err) {
    return { ok: false, error: err.stderr || err.message };
  }
}

/**
 * Fetch the logged-in GitHub user's login via API. Used for CLAUDE_DEV_PAT_OWNER default.
 */
export async function ghWhoami() {
  const { stdout } = await run('gh', ['api', 'user', '--jq', '.login']);
  return stdout.trim();
}

/**
 * Validate that the target repo exists and the viewer has admin/maintainer permission.
 * Returns { ok, repo, viewerPermission, defaultBranch } or { ok: false, error }.
 */
export async function ghRepoInfo(repo) {
  try {
    const { stdout } = await run('gh', [
      'repo',
      'view',
      repo,
      '--json',
      'nameWithOwner,defaultBranchRef,viewerPermission',
    ]);
    const j = JSON.parse(stdout);
    return {
      ok: true,
      repo: j.nameWithOwner,
      defaultBranch: j.defaultBranchRef?.name,
      viewerPermission: j.viewerPermission,
    };
  } catch (err) {
    return { ok: false, error: err.stderr || err.message };
  }
}

/**
 * Check if a branch exists on the target repo.
 */
export async function ghBranchExists(repo, branch) {
  try {
    await run('gh', ['api', `repos/${repo}/branches/${branch}`]);
    return true;
  } catch {
    return false;
  }
}
