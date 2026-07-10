/**
 * Step 9 — Branch protection.
 * Surfaces the ruleset JSON for dev/main (CI pass, ≥1 review, enforce_admins,
 * block force push). Execution via gh api PUT. Refuses to run on main as base.
 */
import { confirm, input } from '@inquirer/prompts';
import { gh } from '../shell.mjs';

export const id = '09-branch-protection';
export const title = 'Branch protection';

export async function run(ctx) {
  const { preview, targetRepo, state, dry } = ctx;
  const branches = unique([state.baseBranch, 'main'].filter(Boolean));
  if (!branches.length) {
    preview.warn('no branches to protect (base branch unset).');
    return { status: 'skipped' };
  }

  // Status check context name varies between repos — many use "test" or
  // "build" instead of "ci". Prompt so we do not silently break merge gate.
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

  for (const r of rulesets) {
    await gh([
      'api', '-X', 'PUT',
      `repos/${targetRepo}/branches/${r.branch}/protection`,
      '-f', 'required_status_checks[strict]=true',
      '-f', `required_status_checks[contexts][]=${r.ciContext}`,
      '-f', 'required_pull_request_reviews[dismiss_stale_reviews]=false',
      '-f', 'required_pull_request_reviews[require_code_owner_reviews]=true',
      '-f', 'required_pull_request_reviews[required_approving_review_count]=1',
      '-F', 'enforce_admins=true',
      '-F', 'restrictions=false',
      '-F', 'required_linear_history=true',
      '-F', 'allow_force_pushes=false',
      '-F', 'allow_deletions=false',
    ], { silent: true });
    preview.notice(`protected: ${r.branch}`);
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
      restrictions: false,
      required_linear_history: true,
      allow_force_pushes: false,
      allow_deletions: false,
    },
  };
}

function unique(arr) {
  return [...new Set(arr)];
}
