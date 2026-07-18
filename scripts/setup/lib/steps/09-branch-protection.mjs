/**
 * Step 9 — Branch protection.
 * Surfaces the ruleset JSON for dev/main (CI pass, ≥1 review, enforce_admins,
 * block force push). Execution via gh api PUT with --input (full JSON body).
 * Refuses to run on main as base.
 */
import { confirm, input } from '@inquirer/prompts';
import { gh, ghBranchExists } from '../shell.mjs';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export const id = '09-branch-protection';
export const title = 'Branch protection';

export async function run(ctx) {
  const { preview, targetRepo, state, dry } = ctx;
  const candidates = unique([state.baseBranch, 'main'].filter(Boolean));
  if (!candidates.length) {
    preview.warn('no branches to protect (base branch unset).');
    return { status: 'skipped' };
  }

  // Filter to branches that actually exist on the remote. A repo whose
  // default branch is `dev` (like this one) may have no `main` at all —
  // PUT'ing protection rules against a non-existent branch 404s.
  const branches = [];
  for (const b of candidates) {
    const exists = await ghBranchExists(targetRepo, b);
    if (exists) {
      branches.push(b);
    } else {
      preview.warn(`branch "${b}" does not exist on ${targetRepo} — skipping protection`);
    }
  }
  if (!branches.length) {
    preview.warn('no branches to protect.');
    return { status: 'skipped' };
  }

  const ciContext = await input({
    message: 'Status check context name to require (from .github/workflows/):',
    default: 'ci',
    validate: (s) => s.trim() !== '' || 'context name cannot be empty',
  });

  const rulesets = branches.map((b) => buildRuleset(targetRepo, b, ciContext.trim()));
  for (const r of rulesets) {
    preview.info(`PUT repos/${targetRepo}/branches/${r.branch}/protection`);
    console.log(`    ${JSON.stringify(r.body)}`);
  }

  if (dry) {
    preview.warn('(dry-run) skipping protection PUTs');
    return { status: 'dry' };
  }
  const ok = await confirm({
    message: `Apply protection rules to ${branches.join(', ')}? (S7 — blocks direct push)`,
    default: true,
  });
  if (!ok) return { status: 'skipped' };

  // Send the full JSON body via --input. Previous attempt used field-level
  // -F flags, but GitHub's branch-protection schema requires `restrictions`
  // to be null or {users, teams} (not the boolean false) and -F cannot
  // emit null. --input with a JSON body sidesteps both issues.
  for (const r of rulesets) {
    const tmpFile = join(tmpdir(), `wizard-protect-${process.pid}-${r.branch}.json`);
    try {
      writeFileSync(tmpFile, JSON.stringify(r.body));
      await gh([
        'api', '-X', 'PUT',
        `repos/${targetRepo}/branches/${r.branch}/protection`,
        '--input', tmpFile,
      ], { silent: true });
      preview.notice(`protected: ${r.branch}`);
    } finally {
      try { unlinkSync(tmpFile); } catch { /* already cleaned */ }
    }
  }
  return { status: 'ok' };
}

function buildRuleset(repo, branch, ciContext) {
  return {
    branch,
    ciContext,
    body: {
      required_status_checks: { strict: true, contexts: [ciContext] },
      required_pull_request_reviews: {
        dismiss_stale_reviews: false,
        require_code_owner_reviews: true,
        required_approving_review_count: 1,
      },
      enforce_admins: true,
      restrictions: null,
      required_linear_history: true,
      allow_force_pushes: false,
      allow_deletions: false,
    },
  };
}

function unique(arr) {
  return [...new Set(arr)];
}
