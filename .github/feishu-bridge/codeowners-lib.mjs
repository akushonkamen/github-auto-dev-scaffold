/**
 * codeowners-lib.mjs — CODEOWNERS parser + ownership matcher (self-contained)
 *
 * 选型决策（PR-5 前置 spike，对应 plan §PR-5）：
 *   原计划用 `codeowners` npm 包（@github/codeowners），但它依赖 `ignore` 包做
 *   匹配且无 negation 显式 API，且只支持从磁盘读取 CODEOWNERS 文件，无法直接
 *   喂入从 GitHub API 取到的内容。本集成需要：
 *     1. 从 GitHub contents API 拿 CODEOWNERS 文本（ETag 缓存）
 *     2. 内存中解析 + 匹配（不写盘）
 *     3. 支持 negation（CODEOWNERS 规范允许 `!pattern`）
 *   因此自写最小实现，用 `minimatch`（已声明依赖，支持 negation）。
 *
 * GitHub CODEOWNERS 规范要点：
 *   - 行格式：`<pattern> <owner1> <owner2> ...`
 *   - `#` 开头注释，空行跳过
 *   - 后写规则优先（last match wins）
 *   - `pattern` 用 .gitignore 风格 glob：
 *       `*`          任意非 `/` 字符
 *       `**`         任意字符含 `/`
 *       `dir/`       目录及其下所有文件
 *       `!pattern`   negation（最后一条匹配 wins）
 *   - owner 形如 `@user` / `@org/team` / `user@example.com`
 */
import { Minimatch } from 'minimatch';

/**
 * Parse CODEOWNERS file content into ordered rule entries.
 * Entries are returned in original order; callers should iterate in reverse
 * (last match wins) per GitHub spec.
 *
 * @param {string} content — raw CODEOWNERS file text
 * @returns {Array<{ pattern: string, owners: string[], matcher: Minimatch }>}
 */
export function parseCodeowners(content) {
  if (typeof content !== 'string') {
    throw new Error('CODEOWNERS content must be a string');
  }
  const entries = [];
  for (const rawLine of content.split(/\r\n|\r|\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const [rawPattern, ...owners] = line.split(/\s+/);
    if (!rawPattern || owners.length === 0) continue;
    const negated = rawPattern.startsWith('!');
    const pattern = negated ? rawPattern.slice(1) : rawPattern;
    entries.push({
      pattern: rawPattern,
      owners,
      negated,
      matcher: new Minimatch(normalizePattern(pattern), { dot: true, noglobstar: false }),
    });
  }
  return entries;
}

/**
 * Normalize a CODEOWNERS pattern into a minimatch-compatible glob.
 *
 * Rules (GitHub CODEOWNERS spec):
 *   - Leading slash → anchored to root (strip it; minimatch is anchored by
 *     default unless pattern contains no slash).
 *   - No slash anywhere (e.g. `*.js`, `Makefile`) → match anywhere in tree,
 *     prepend `globstar slash`.
 *   - Trailing slash (directory like `src/`) → append `**` to match descendants.
 */
function normalizePattern(pattern) {
  let p = pattern;
  let anchored = false;
  if (p.startsWith('/')) {
    p = p.slice(1);
    anchored = true;
  }
  if (p.endsWith('/')) {
    p = p + '**';
  }
  // If the stripped pattern contains no `/`, it should match anywhere
  // (CODEOWNERS `*.js` matches `a/b/foo.js`).
  if (!anchored && !p.includes('/')) {
    p = '**/' + p;
  }
  return p;
}

/**
 * Find owners for a single file path. Iterates from last rule to first
 * (GitHub "last match wins" semantics). Negation rules (`!pattern`) that match
 * cause the path to be treated as unowned (return []).
 *
 * Returns [] if no rule matches OR a negation rule wins.
 */
export function getOwners(filePath, entries) {
  if (typeof filePath !== 'string' || filePath.length === 0) return [];
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.matcher.match(filePath)) {
      return entry.negated ? [] : entry.owners;
    }
  }
  return [];
}

function normalizeOwner(owner) {
  if (typeof owner !== 'string') return '';
  return owner.replace(/^@/, '').toLowerCase();
}

/**
 * Return true if `githubUser` is listed as an owner of ANY of the given files.
 *
 * @param {string[]} filePaths
 * @param {string} githubUser — GitHub username (login), case-insensitive compare
 * @param {Array} entries — output of parseCodeowners()
 */
export function isOwnerOfAnyFile(filePaths, githubUser, entries) {
  if (!Array.isArray(filePaths) || filePaths.length === 0) return false;
  const target = normalizeOwner(githubUser);
  if (!target) return false;
  for (const file of filePaths) {
    const owners = getOwners(file, entries);
    if (owners.some((o) => normalizeOwner(o) === target)) {
      return true;
    }
  }
  return false;
}
