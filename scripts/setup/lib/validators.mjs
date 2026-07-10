/**
 * Input validators for the setup wizard. Pure functions, sync, easy to unit-test.
 *
 * Every validator returns `{ ok: true }` or `{ ok: false, error: "..." }`.
 */

export function validateRepo(s) {
  if (typeof s !== 'string' || s.trim() === '') {
    return { ok: false, error: 'repo must be a non-empty string' };
  }
  const trimmed = s.trim();
  // GitHub repo slug: owner/name where each side is [A-Za-z0-9._-]+
  // owner can also be an org; same character class
  const m = trimmed.match(/^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/);
  if (!m) {
    return {
      ok: false,
      error: 'repo must be in "owner/name" form (e.g. "akushonkamen/my-repo")',
    };
  }
  if (m[1].length > 39 || m[2].length > 100) {
    return { ok: false, error: 'owner or repo name too long' };
  }
  if (m[1].startsWith('.') || m[2].startsWith('.')) {
    return { ok: false, error: 'owner/repo cannot start with a dot' };
  }
  return { ok: true, value: trimmed };
}

export function validateBranchName(s) {
  if (typeof s !== 'string' || s.trim() === '') {
    return { ok: false, error: 'branch name cannot be empty' };
  }
  const trimmed = s.trim();
  // Reject gitrefs that would break workflow triggers
  if (/^refs\/(heads|tags)\//.test(trimmed)) {
    return { ok: false, error: 'branch name should not include the refs/heads/ prefix' };
  }
  if (/[~^:?*\[\]\\]/.test(trimmed)) {
    return { ok: false, error: 'branch name contains forbidden git character' };
  }
  if (trimmed.includes(' ') || trimmed.includes('..')) {
    return { ok: false, error: 'branch name cannot contain spaces or ".."' };
  }
  if (trimmed.startsWith('-')) {
    return { ok: false, error: 'branch name cannot start with "-"' };
  }
  return { ok: true, value: trimmed };
}

export function isForbiddenBaseBranch(s) {
  // S3: AI code never lands on main/master
  return s === 'main' || s === 'master';
}

export function validateHttpUrl(s, { allowEmpty = false } = {}) {
  if (allowEmpty && s === '') return { ok: true, value: '' };
  if (typeof s !== 'string' || s.trim() === '') {
    return { ok: false, error: 'URL cannot be empty' };
  }
  const trimmed = s.trim().replace(/\/+$/, ''); // strip trailing slashes
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
      return { ok: false, error: 'URL must use http(s)' };
    }
    return { ok: true, value: trimmed };
  } catch {
    return { ok: false, error: 'URL is malformed' };
  }
}

export function validateModelId(s) {
  if (typeof s !== 'string' || s.trim() === '') {
    return { ok: false, error: 'model id cannot be empty' };
  }
  const trimmed = s.trim();
  // Provider model IDs: lowercase alnum, dashes, dots, colons (for version tags)
  if (!/^[A-Za-z0-9._:-]+$/.test(trimmed)) {
    return { ok: false, error: 'model id contains forbidden character' };
  }
  if (trimmed.length > 128) {
    return { ok: false, error: 'model id too long (>128 chars)' };
  }
  return { ok: true, value: trimmed };
}

export function validatePAT(s) {
  if (typeof s !== 'string' || s === '') {
    return { ok: false, error: 'PAT cannot be empty' };
  }
  // Fine-grained PAT format: github_pat_<base62>
  // Classic PAT formats (rejected per S6): ghp_*, gho_*, ghs_*, ghu_*, gha_*, ghR_*
  if (s.startsWith('github_pat_')) {
    if (s.length < 20) {
      return { ok: false, error: 'fine-grained PAT looks truncated (<20 chars)' };
    }
    if (!/^github_pat_[A-Za-z0-9_]+$/.test(s)) {
      return { ok: false, error: 'fine-grained PAT contains forbidden character' };
    }
    return { ok: true, value: s, kind: 'fine-grained' };
  }
  if (/^(ghp|gho|ghs|ghu|gha|ghr|ghR)_/.test(s)) {
    return {
      ok: false,
      error: 'classic PAT detected — S6 forbids classic PATs; create a fine-grained PAT (github_pat_*) instead',
    };
  }
  return { ok: false, error: 'PAT does not match any known GitHub token format' };
}

export function validateNotionKey(s) {
  if (typeof s !== 'string' || s === '') {
    return { ok: false, error: 'Notion key cannot be empty' };
  }
  // Notion internal integration tokens: secret_<base64> or newer ntn_<base64>
  if (!/^(secret_|ntn_)[A-Za-z0-9_]+$/.test(s)) {
    return {
      ok: false,
      error: 'Notion key should start with "secret_" or "ntn_"',
    };
  }
  return { ok: true, value: s };
}

export function validateNotionDatabaseId(s) {
  if (typeof s !== 'string' || s.trim() === '') {
    return { ok: false, error: 'database id cannot be empty' };
  }
  const trimmed = s.trim().replace(/-/g, '');
  // 32 hex chars with or without dashes
  if (!/^[A-Fa-f0-9]{32}$/.test(trimmed)) {
    return { ok: false, error: 'database id must be 32 hex chars (UUID form, dashes optional)' };
  }
  return { ok: true, value: s.trim() };
}

export function validateTeamSlug(s) {
  if (typeof s !== 'string' || s.trim() === '') {
    return { ok: false, error: 'team slug / login cannot be empty' };
  }
  const trimmed = s.trim();
  // Accept either @login / @org/team or bare login / org/team
  const bare = trimmed.replace(/^@/, '');
  if (bare.includes('/')) {
    // org/team form — exactly one slash
    const parts = bare.split('/');
    if (parts.length !== 2) {
      return { ok: false, error: 'team slug must look like "org/team-slug" (one slash)' };
    }
    const [org, team] = parts;
    if (!org || !team || !/^[A-Za-z0-9._-]+$/.test(org) || !/^[A-Za-z0-9._-]+$/.test(team)) {
      return { ok: false, error: 'team slug must look like "org/team-slug"' };
    }
    return { ok: true, value: bare };
  }
  // Bare login
  if (!/^[A-Za-z0-9._-]+$/.test(bare)) {
    return { ok: false, error: 'login contains forbidden character' };
  }
  if (bare.length > 39) {
    return { ok: false, error: 'login too long (>39 chars)' };
  }
  return { ok: true, value: bare };
}

export function validatePositiveInt(s, { max = 10000 } = {}) {
  const n = Number(s);
  if (!Number.isInteger(n) || n <= 0) {
    return { ok: false, error: 'must be a positive integer' };
  }
  if (n > max) {
    return { ok: false, error: `must be <= ${max}` };
  }
  return { ok: true, value: n };
}

/**
 * Mask a secret for preview/log output. Keeps prefix + last 4 chars,
 * redacts the middle. e.g. "github_pat_abcdef12345" → "github_pat_…2345".
 */
export function maskSecret(s) {
  if (typeof s !== 'string' || s.length < 10) return '***';
  // Recognise known token prefixes; otherwise fall back to first 4 chars.
  const knownPrefixes = ['github_pat_', 'ntn_', 'secret_', 'ghp_', 'gho_', 'ghs_', 'ghu_', 'gha_', 'ghr_'];
  const matched = knownPrefixes.find((p) => s.startsWith(p));
  const prefix = matched || s.slice(0, 4);
  const tail = s.slice(-4);
  return `${prefix}…${tail}`;
}
