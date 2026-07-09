#!/usr/bin/env bash
# ============================================================================
# LAYER 3 — Workflow logic: dry-run decision trees without LLM calls
#
# Simulates every decision branch in the 3 workflows using mock outputs.
# Verifies the correct label transitions, gate conditions, and edge cases.
# No network, no real LLM, no GitHub.
# ============================================================================
set -euo pipefail

PASS=0
FAIL=0

GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'

pass() { PASS=$((PASS+1)); printf "  ${GREEN}PASS${NC} %s\n" "$1"; }
fail() { FAIL=$((FAIL+1)); printf "  ${RED}FAIL${NC} %s\n" "$1"; }

# ─── Helpers ─────────────────────────────────────────────────────────────

# Simulate triage-issue.yml decision routing (AC-C7 + v2 clarify handoff)
simulate_triage_route() {
  local decision="$1" confidence="$2" auto_accept="$3"
  local threshold="${4:-0.7}"
  local result=""

  if [ "$decision" = "reply" ]; then
    result="comment_only"
  elif [ "$decision" = "work" ]; then
    if [ -z "$confidence" ] || [ "$(printf '%s' "$confidence" | awk '{print ($1 < '"$threshold"')}')" = "1" ]; then
      # Low confidence or empty → queue clarify loop
      result="needs-clarify"
    else
      # High confidence
      if [ "$auto_accept" = "true" ]; then
        result="auto-accept"
      else
        result="recommend-acceptance"
      fi
    fi
  fi
  printf '%s' "$result"
}

# Simulate clarify-loop dispatch shell (actions → labels)
simulate_clarify_dispatch() {
  local action="$1" round="$2" max_rounds="${3:-3}"
  local result=""

  if [ "$round" -gt "$max_rounds" ]; then
    result="max-rounds→needs-ralph"
  else
    case "$action" in
      ask)   result="clarify-r-${round}" ;;
      accept) result="accepted-by-claude→develop" ;;
      yield)  result="yielded" ;;
      *)     result="invalid-action" ;;
    esac
  fi
  printf '%s' "$result"
}

# Simulate develop.yml S3 guard
simulate_develop_s3_guard() {
  local base="$1"
  case "$base" in
    main|master) printf '%s' "BLOCKED-S3" ;;
    *) printf '%s' "allowed" ;;
  esac
}

# ─── Triage decision tree ────────────────────────────────────────────────

echo ""
echo "=== LAYER 3: Workflow Logic Tests ==="
echo ""

echo "── Triage routing (triage-issue.yml) ──"

# reply → comment only
[ "$(simulate_triage_route "reply" "" "false")" = "comment_only" ] \
  && pass "reply → comment-only (any confidence)" \
  || fail "reply → comment-only"

# work + high confidence + auto_accept=true
[ "$(simulate_triage_route "work" "0.9" "true")" = "auto-accept" ] \
  && pass "work 0.9 + AA=true → auto-accept" \
  || fail "work 0.9 + AA=true → auto-accept"

# work + high confidence + auto_accept=false
[ "$(simulate_triage_route "work" "0.9" "false")" = "recommend-acceptance" ] \
  && pass "work 0.9 + AA=false → recommend-acceptance" \
  || fail "work 0.9 + AA=false → recommend-acceptance"

# work + low confidence → needs-clarify (regardless of AA)
[ "$(simulate_triage_route "work" "0.5" "true")" = "needs-clarify" ] \
  && pass "work 0.5 + AA=true → needs-clarify (low conf overrides AA)" \
  || fail "work 0.5 + AA=true → needs-clarify"

[ "$(simulate_triage_route "work" "0.5" "false")" = "needs-clarify" ] \
  && pass "work 0.5 + AA=false → needs-clarify" \
  || fail "work 0.5 + AA=false → needs-clarify"

# work + empty confidence → needs-clarify (safer to refine)
[ "$(simulate_triage_route "work" "" "true")" = "needs-clarify" ] \
  && pass "work (empty confidence) → needs-clarify (safer)" \
  || fail "work (empty confidence) → needs-clarify"

# work + confidence at exact threshold (0.7) → high (not less-than, so passes threshold)
[ "$(simulate_triage_route "work" "0.7" "true")" = "auto-accept" ] \
  && pass "work 0.7 (exact threshold) → auto-accept (>= threshold)" \
  || fail "work 0.7 (exact threshold) → auto-accept"

# work + high confidence with custom threshold
[ "$(simulate_triage_route "work" "0.6" "true" "0.5")" = "auto-accept" ] \
  && pass "work 0.6 + threshold=0.5 → auto-accept" \
  || fail "work 0.6 + threshold=0.5 → auto-accept"

echo ""
echo "── Clarify dispatch shell (clarify-loop.yml) ──"

# ask → clarify-r-N
[ "$(simulate_clarify_dispatch "ask" "1")" = "clarify-r-1" ] \
  && pass "ask round 1 → clarify-r-1" \
  || fail "ask round 1 → clarify-r-1"

[ "$(simulate_clarify_dispatch "ask" "2")" = "clarify-r-2" ] \
  && pass "ask round 2 → clarify-r-2" \
  || fail "ask round 2 → clarify-r-2"

# accept → accepted-by-claude
[ "$(simulate_clarify_dispatch "accept" "1")" = "accepted-by-claude→develop" ] \
  && pass "accept round 1 → accepted-by-claude → develop" \
  || fail "accept round 1 → accepted-by-claude"

[ "$(simulate_clarify_dispatch "accept" "2")" = "accepted-by-claude→develop" ] \
  && pass "accept round 2 → accepted-by-claude → develop" \
  || fail "accept round 2 → accepted-by-claude"

# yield → yielded
[ "$(simulate_clarify_dispatch "yield" "1")" = "yielded" ] \
  && pass "yield round 1 → yielded" \
  || fail "yield round 1 → yielded"

[ "$(simulate_clarify_dispatch "yield" "2")" = "yielded" ] \
  && pass "yield round 2 → yielded" \
  || fail "yield round 2 → yielded"

# max-rounds exhaustion
[ "$(simulate_clarify_dispatch "ask" "4" "3")" = "max-rounds→needs-ralph" ] \
  && pass "ask round 4 (max=3) → max-rounds → needs-ralph" \
  || fail "ask round 4 (max=3) → max-rounds"

[ "$(simulate_clarify_dispatch "yield" "5" "3")" = "max-rounds→needs-ralph" ] \
  && pass "yield round 5 (max=3) → max-rounds → needs-ralph" \
  || fail "yield round 5 (max=3) → max-rounds"

# invalid action
[ "$(simulate_clarify_dispatch "reject" "1")" = "invalid-action" ] \
  && pass "action=reject → invalid (not in sealed schema enum)" \
  || fail "action=reject → should be invalid"

echo ""
echo "── Develop S3 guard (develop.yml) ──"

# S3: refuse main/master
[ "$(simulate_develop_s3_guard "main")" = "BLOCKED-S3" ] \
  && pass "develop base=main → BLOCKED (S3)" \
  || fail "develop base=main → should block"

[ "$(simulate_develop_s3_guard "master")" = "BLOCKED-S3" ] \
  && pass "develop base=master → BLOCKED (S3)" \
  || fail "develop base=master → should block"

# S3: allow other branches
[ "$(simulate_develop_s3_guard "dev")" = "allowed" ] \
  && pass "develop base=dev → allowed" \
  || fail "develop base=dev → should allow"

[ "$(simulate_develop_s3_guard "feature/test")" = "allowed" ] \
  && pass "develop base=feature/test → allowed" \
  || fail "develop base=feature/test → should allow"

echo ""
echo "── Concurrency guard ──"

# verify concurrency groups are issue-scoped (static check via grep)
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

for wf in triage-issue.yml clarify-loop.yml develop.yml self-verify.yml; do
  wf_path="$ROOT/.github/workflows/$wf"
  if grep -q "cancel-in-progress: false" "$wf_path"; then
    pass "$wf: cancel-in-progress=false (serial per issue)"
  else
    fail "$wf: missing cancel-in-progress guard"
  fi
  if grep -qE 'group: (triage|clarify|develop)-issue-\$\{\{' "$wf_path"; then
    pass "$wf: concurrency group scoped to issue number"
  else
    fail "$wf: concurrency group not scoped to issue number"
  fi
done

echo ""
echo "── Trigger correctness ──"

# triage-issue triggers on issues.opened + workflow_dispatch
grep -q "issues:" "$ROOT/.github/workflows/triage-issue.yml" \
  && pass "triage-issue.yml triggers on issues" \
  || fail "triage-issue.yml missing issues trigger"

# clarify-loop triggers on issues.labeled + issue_comment
grep -q "issue_comment:" "$ROOT/.github/workflows/clarify-loop.yml" \
  && pass "clarify-loop.yml triggers on issue_comment" \
  || fail "clarify-loop.yml missing issue_comment trigger"

# develop triggers on issues.labeled
grep -q "labeled" "$ROOT/.github/workflows/develop.yml" \
  && pass "develop.yml triggers on issues.labeled" \
  || fail "develop.yml missing issues.labeled trigger"

# self-verify triggers on pull_request
grep -q "pull_request:" "$ROOT/.github/workflows/self-verify.yml" \
  && pass "self-verify.yml triggers on pull_request" \
  || fail "self-verify.yml missing pull_request trigger"

# self-verify filters by claude/issue- branch pattern
grep -q 'claude/issue-' "$ROOT/.github/workflows/self-verify.yml" \
  && pass "self-verify.yml: filters claude/issue- branch pattern" \
  || fail "self-verify.yml: missing claude/issue- branch filter"

echo ""
echo "── DENY_LIST completeness ──"

# Verify the 6-label DENY_LIST is present in clarify-loop.yml
DENY_LIST_LABELS=("accepted" "rejected" "design-approved" "needs-info" "needs-clarify" "triage")
for label in "${DENY_LIST_LABELS[@]}"; do
  if grep -q "DENY_LIST=.*$label" "$ROOT/.github/workflows/clarify-loop.yml"; then
    pass "DENY_LIST: '$label' present in clarify-loop.yml"
  else
    fail "DENY_LIST: '$label' MISSING from clarify-loop.yml"
  fi
done

echo ""
echo "── S1 permission enforcement ──"

# Triage and clarify workflows MUST NOT have contents:write
for wf in triage-issue.yml clarify-loop.yml; do
  wf_path="$ROOT/.github/workflows/$wf"
  # Check workflow-level permissions
  if grep -A5 "^permissions:" "$wf_path" | grep -q "contents: write"; then
    fail "$wf: workflow-level contents:write detected (S1 violation)"
  else
    pass "$wf: no workflow-level contents:write (S1 OK)"
  fi
done

# develop.yml IS allowed contents:write (Module 4 exception per S1)
if grep -A5 "^permissions:" "$ROOT/.github/workflows/develop.yml" | grep -q "contents: write"; then
  pass "develop.yml: contents:write allowed per S1 Module 4 exception"
else
  fail "develop.yml: missing contents:write (needed for branch push)"
fi

echo ""
echo "── Label transition completeness ──"

# accepted-by-claude → in-development transition in develop.yml
grep -q "accepted-by-claude" "$ROOT/.github/workflows/develop.yml" \
  && pass "develop.yml: removes accepted-by-claude → in-development" \
  || fail "develop.yml: accepted-by-claude transition missing"

# accepted → in-development transition in develop.yml
grep -q "accepted" "$ROOT/.github/workflows/develop.yml" \
  && pass "develop.yml: handles accepted label transition" \
  || fail "develop.yml: accepted transition missing"

echo ""
echo "── Log-scan AC-V2-13a ──"

for wf in clarify-loop.yml; do
  wf_path="$ROOT/.github/workflows/$wf"
  if grep -q "ghp_\|github_pat_\|CLAUDE_DEV_PAT" "$wf_path"; then
    pass "$wf: log-scan patterns present (AC-V2-13a)"
  else
    fail "$wf: log-scan patterns missing (AC-V2-13a)"
  fi
done

echo ""
echo "── Self-verify decision tree ──"

# Simulate self-verify status → label transition
simulate_verify_transition() {
  local status="$1"
  case "$status" in
    passed) printf '%s' "verified" ;;
    failed) printf '%s' "verify:failed" ;;
    *)      printf '%s' "unknown" ;;
  esac
}

# passed → verified
[ "$(simulate_verify_transition "passed")" = "verified" ] \
  && pass "verify passed → verified label" \
  || fail "verify passed → verified label"

# failed → verify:failed
[ "$(simulate_verify_transition "failed")" = "verify:failed" ] \
  && pass "verify failed → verify:failed label" \
  || fail "verify failed → verify:failed label"

# unknown status
[ "$(simulate_verify_transition "unknown")" = "unknown" ] \
  && pass "verify unknown status → unknown (no label)" \
  || fail "verify unknown status → unknown"

# self-verify concurrency guard
grep -q "cancel-in-progress: false" "$ROOT/.github/workflows/self-verify.yml" \
  && pass "self-verify.yml: cancel-in-progress=false (serial per PR)" \
  || fail "self-verify.yml: missing cancel-in-progress guard"

grep -qE 'group: self-verify-pr-\$\{\{' "$ROOT/.github/workflows/self-verify.yml" \
  && pass "self-verify.yml: concurrency group scoped to PR number" \
  || fail "self-verify.yml: concurrency group not scoped to PR number"

# self-verify S1: no contents:write at workflow level
if grep -A5 "^permissions:" "$ROOT/.github/workflows/self-verify.yml" | grep -q "contents: write"; then
  fail "self-verify.yml: workflow-level contents:write detected (S1 violation)"
else
  pass "self-verify.yml: no workflow-level contents:write (S1 OK)"
fi

# self-verify S1: no contents:write at job level
if grep -A5 "permissions:" "$ROOT/.github/workflows/self-verify.yml" | grep -q "contents: write"; then
  fail "self-verify.yml: job-level contents:write detected (S1 violation)"
else
  pass "self-verify.yml: no job-level contents:write (S1 OK)"
fi

# self-verify uses CLAUDE_DEV_PAT for label writes (PR #16 lesson)
grep -q "CLAUDE_DEV_PAT" "$ROOT/.github/workflows/self-verify.yml" \
  && pass "self-verify.yml: uses CLAUDE_DEV_PAT for label writes (downstream trigger)" \
  || fail "self-verify.yml: missing CLAUDE_DEV_PAT for label writes"

# self-verify audit comment on issue
grep -q "gh issue comment" "$ROOT/.github/workflows/self-verify.yml" \
  && pass "self-verify.yml: posts audit comment on issue" \
  || fail "self-verify.yml: missing audit comment step"

# self-verify labels present in labels.yml
for label in "verifying" "verified" "verify:failed"; do
  if grep -q "\"$label\"" "$ROOT/.github/labels.yml"; then
    pass "labels.yml: '$label' label present"
  else
    fail "labels.yml: '$label' label MISSING"
  fi
done

echo ""
echo "── Self-verify S5 sandbox ──"

# S5: self-verify action denies Bash + Write
grep -q 'deny.*Bash.*Write' "$ROOT/.github/actions/self-verify/action.yml" \
  && pass "self-verify action: denies Bash + Write (S5 OK)" \
  || fail "self-verify action: missing Bash/Write deny (S5 violation)"

# S5: self-verify action allows Read, Grep, Glob only
grep -q 'allow.*Read.*Grep.*Glob' "$ROOT/.github/actions/self-verify/action.yml" \
  && pass "self-verify action: allows Read, Grep, Glob only (S5 OK)" \
  || fail "self-verify action: missing Read/Grep/Glob allow list (S5 violation)"

echo ""
echo "── Branch naming convention ──"

# Verify claude/issue-N-slug pattern
grep -q 'claude/issue-' "$ROOT/.github/workflows/develop.yml" \
  && pass "develop.yml: branch naming claude/issue-N-slug" \
  || fail "develop.yml: branch naming pattern missing"

echo ""
echo "── Preflight gate conditions ──"

# develop preflight: reject on issue state != OPEN
grep -q 'state.*OPEN' "$ROOT/.github/workflows/develop.yml" \
  && pass "develop.yml: preflight checks issue state=OPEN" \
  || fail "develop.yml: preflight missing OPEN check"

# develop preflight: reject on rejected/force-manual labels
grep -q "rejected\|force-manual" "$ROOT/.github/workflows/develop.yml" \
  && pass "develop.yml: preflight rejects rejected/force-manual labels" \
  || fail "develop.yml: preflight missing override label check"

echo ""
echo "── Race guard AC-V2-8b ──"

# clarify-loop must re-fetch labels before accepted-by-claude write
grep -q "gh issue view.*--json labels" "$ROOT/.github/workflows/clarify-loop.yml" \
  && pass "clarify-loop.yml: AC-V2-8b re-fetch labels before accept write" \
  || fail "clarify-loop.yml: AC-V2-8b label re-fetch missing"

echo ""
echo "── Branch protection CI check (branch-protection.yml) ──"

# Simulate branch-protection decision: returns "allowed" or "blocked"
simulate_branch_protection() {
  local head_ref="$1" labels="$2"
  # Rule 1: claude/issue-N-* branches are always allowed
  if echo "$head_ref" | grep -qE '^claude/issue-[0-9]+'; then
    printf '%s' "allowed"
    return
  fi
  # Rule 2: pipeline-fix label allows
  if echo "$labels" | grep -qFx 'pipeline-fix'; then
    printf '%s' "allowed"
    return
  fi
  printf '%s' "blocked"
}

# claude/issue-N branches pass
[ "$(simulate_branch_protection "claude/issue-15-dogfood" "")" = "allowed" ] \
  && pass "claude/issue-15-dogfood → allowed (pipeline branch)" \
  || fail "claude/issue-15-dogfood → should be allowed"

[ "$(simulate_branch_protection "claude/issue-1-fix-typo" "some-other-label")" = "allowed" ] \
  && pass "claude/issue-1-fix-typo + other labels → allowed" \
  || fail "claude/issue-1-fix-typo + other labels → should be allowed"

# pipeline-fix label passes
[ "$(simulate_branch_protection "fix-workflow-bug" "pipeline-fix")" = "allowed" ] \
  && pass "fix-workflow-bug + pipeline-fix label → allowed (S7 escape hatch)" \
  || fail "fix-workflow-bug + pipeline-fix label → should be allowed"

# Non-conforming branch without pipeline-fix is blocked
[ "$(simulate_branch_protection "feature/foo" "")" = "blocked" ] \
  && pass "feature/foo (no label) → blocked" \
  || fail "feature/foo (no label) → should be blocked"

[ "$(simulate_branch_protection "main" "")" = "blocked" ] \
  && pass "main (direct push attempt) → blocked" \
  || fail "main (direct push attempt) → should be blocked"

[ "$(simulate_branch_protection "bugfix/unauthorized" "bug,enhancement")" = "blocked" ] \
  && pass "bugfix/unauthorized + unrelated labels → blocked" \
  || fail "bugfix/unauthorized + unrelated labels → should be blocked"

# Edge: pipeline-fix label with non-standard branch is allowed
[ "$(simulate_branch_protection "hotfix/critical" "pipeline-fix")" = "allowed" ] \
  && pass "hotfix/critical + pipeline-fix → allowed (escape hatch)" \
  || fail "hotfix/critical + pipeline-fix → should be allowed"

# Edge: claude/issue- prefix but no number → blocked (strict pattern)
[ "$(simulate_branch_protection "claude/issue-abc" "")" = "blocked" ] \
  && pass "claude/issue-abc (non-numeric) → blocked (strict pattern)" \
  || fail "claude/issue-abc → should be blocked (strict pattern requires digits)"

[ "$(simulate_branch_protection "claude/issue-" "")" = "blocked" ] \
  && pass "claude/issue- (no number) → blocked (strict pattern)" \
  || fail "claude/issue- → should be blocked (strict pattern requires digits)"

echo ""
echo "── AC-V2-3c sentinel marker ──"

grep -q "claude-clarify-round-" "$ROOT/.github/workflows/clarify-loop.yml" \
  && pass "clarify-loop.yml: AC-V2-3c sentinel marker re-entrancy guard" \
  || fail "clarify-loop.yml: AC-V2-3c sentinel marker missing"

echo ""
echo "── Branch protection workflow structure ──"

BP_WF="$ROOT/.github/workflows/branch-protection.yml"

# File exists
if [ -f "$BP_WF" ]; then
  pass "branch-protection.yml exists"
else
  fail "branch-protection.yml missing"
fi

# Permissions: contents:read + pull-requests:read only (no writes)
if grep -A5 "^permissions:" "$BP_WF" | grep -q "contents: write"; then
  fail "branch-protection.yml: contents:write detected (S1 violation — should be read-only)"
else
  pass "branch-protection.yml: no contents:write (S1 OK)"
fi

if grep -A5 "^permissions:" "$BP_WF" | grep -q "pull-requests: read"; then
  pass "branch-protection.yml: pull-requests:read present"
else
  fail "branch-protection.yml: pull-requests:read missing"
fi

# Triggers on pull_request targeting dev and main
if grep -q "pull_request:" "$BP_WF"; then
  pass "branch-protection.yml: triggers on pull_request"
else
  fail "branch-protection.yml: missing pull_request trigger"
fi

if grep -qE '^\s+-\s+(dev|main)' "$BP_WF"; then
  pass "branch-protection.yml: targets dev and main branches"
else
  fail "branch-protection.yml: missing dev/main branch targets"
fi

# Contains claude/issue-* pattern check
if grep -q 'claude/issue-' "$BP_WF"; then
  pass "branch-protection.yml: enforces claude/issue-* branch pattern"
else
  fail "branch-protection.yml: missing claude/issue-* pattern check"
fi

# Contains pipeline-fix label check
if grep -q 'pipeline-fix' "$BP_WF"; then
  pass "branch-protection.yml: pipeline-fix escape hatch referenced"
else
  fail "branch-protection.yml: missing pipeline-fix reference"
fi

# Audit comment on acceptance
if grep -q "audit comment\|gh pr comment" "$BP_WF"; then
  pass "branch-protection.yml: posts audit comment on check result"
else
  fail "branch-protection.yml: missing audit comment step"
fi

echo ""
echo "── Module 6 Test decision tree ──"

# Simulate test status → label transition
simulate_test_transition() {
  local status="$1"
  case "$status" in
    passed) printf '%s' "tested" ;;
    failed) printf '%s' "test:failed" ;;
    *)      printf '%s' "unknown" ;;
  esac
}

# passed → tested
[ "$(simulate_test_transition "passed")" = "tested" ] \
  && pass "test passed → tested label" \
  || fail "test passed → tested label"

# failed → test:failed
[ "$(simulate_test_transition "failed")" = "test:failed" ] \
  && pass "test failed → test:failed label" \
  || fail "test failed → test:failed label"

# unknown status
[ "$(simulate_test_transition "unknown")" = "unknown" ] \
  && pass "test unknown status → unknown (no label)" \
  || fail "test unknown status → unknown"

echo ""
echo "── Module 6 workflow structure ──"

TEST_WF="$ROOT/.github/workflows/test.yml"

# File exists
if [ -f "$TEST_WF" ]; then
  pass "test.yml exists"
else
  fail "test.yml missing"
fi

# Triggers on issues.labeled with verified
grep -q "labeled" "$TEST_WF" \
  && pass "test.yml: triggers on issues.labeled" \
  || fail "test.yml: missing issues.labeled trigger"

grep -q "verified" "$TEST_WF" \
  && pass "test.yml: triggers on verified label" \
  || fail "test.yml: missing verified label trigger"

# S1: no contents:write at workflow level
if grep -A5 "^permissions:" "$TEST_WF" | grep -q "contents: write"; then
  fail "test.yml: workflow-level contents:write detected (S1 violation)"
else
  pass "test.yml: no workflow-level contents:write (S1 OK)"
fi

# S1: no contents:write at job level
if grep -A5 "permissions:" "$TEST_WF" | grep -q "contents: write"; then
  fail "test.yml: job-level contents:write detected (S1 violation)"
else
  pass "test.yml: no job-level contents:write (S1 OK)"
fi

# Uses CLAUDE_DEV_PAT for label writes (PR #16 lesson)
grep -q "CLAUDE_DEV_PAT" "$TEST_WF" \
  && pass "test.yml: uses CLAUDE_DEV_PAT for label writes (downstream trigger)" \
  || fail "test.yml: missing CLAUDE_DEV_PAT for label writes"

# Posts audit comment on PR
grep -q "gh pr comment" "$TEST_WF" \
  && pass "test.yml: posts audit comment on PR" \
  || fail "test.yml: missing PR audit comment step"

# Posts audit comment on issue
grep -q "gh issue comment" "$TEST_WF" \
  && pass "test.yml: posts audit comment on issue" \
  || fail "test.yml: missing issue audit comment step"

# Concurrency guard
grep -q "cancel-in-progress: false" "$TEST_WF" \
  && pass "test.yml: cancel-in-progress=false (serial per issue)" \
  || fail "test.yml: missing cancel-in-progress guard"

grep -qE 'group: test-issue-\$\{\{' "$TEST_WF" \
  && pass "test.yml: concurrency group scoped to issue number" \
  || fail "test.yml: concurrency group not scoped to issue number"

# S5: Codex permission-profile enforcement
grep -q "permission-profile" "$ROOT/.github/actions/test/action.yml" \
  && pass "test action: permission-profile present (S5 Codex enforcement)" \
  || fail "test action: missing permission-profile (S5 Codex)"

grep -q "workspace-write" "$ROOT/.github/actions/test/action.yml" \
  && pass "test action: permission-profile=workspace-write (S5 OK)" \
  || fail "test action: permission-profile should be workspace-write (S5)"

grep -q "danger-full-access" "$ROOT/.github/actions/test/action.yml" \
  && pass "test action: references danger-full-access prohibition (S5)" \
  || fail "test action: missing danger-full-access guard (S5)"

# S5: No dangerously-skip-permissions
if grep -q "dangerously-skip-permissions" "$ROOT/.github/actions/test/action.yml"; then
  fail "test action: dangerously-skip-permissions detected (S5 violation)"
else
  pass "test action: no dangerously-skip-permissions (S5 OK)"
fi

# Test labels present in labels.yml
for label in "testing" "tested" "test:failed"; do
  if grep -q "\"${label}\"" "$ROOT/.github/labels.yml"; then
    pass "labels.yml: '${label}' label present"
  else
    fail "labels.yml: '${label}' label MISSING"
  fi
done

# Engine codex default
grep -q 'default.*codex' "$ROOT/.github/actions/test/action.yml" \
  && pass "test action: engine defaults to codex (PRD §4)" \
  || fail "test action: engine should default to codex"

# OPENAI_API_KEY (not Anthropic/DeepSeek)
grep -q "OPENAI_API_KEY" "$ROOT/.github/actions/test/action.yml" \
  && pass "test action: uses OPENAI_API_KEY (not DeepSeek, PRD §4)" \
  || fail "test action: missing OPENAI_API_KEY reference"

# test.yml uses OPENAI_API_KEY secret
grep -q "OPENAI_API_KEY" "$TEST_WF" \
  && pass "test.yml: consumes OPENAI_API_KEY secret" \
  || fail "test.yml: missing OPENAI_API_KEY secret"

# Test composite action has sealed schema
grep -q "test_status" "$ROOT/.github/actions/test/action.yml" \
  && pass "test action: sealed schema includes test_status" \
  || fail "test action: missing test_status in schema"

grep -q "tests_added" "$ROOT/.github/actions/test/action.yml" \
  && pass "test action: sealed schema includes tests_added" \
  || fail "test action: missing tests_added in schema"

# test.yml discovers PR from issue comments
grep -q "gh issue view.*--json comments" "$TEST_WF" \
  && pass "test.yml: discovers PR from issue audit comments" \
  || fail "test.yml: missing PR discovery from issue comments"

echo ""
echo "── Module 6 extract.sh ──"

TEST_EXTRACT="$ROOT/.github/actions/test/extract.sh"

if [ -f "$TEST_EXTRACT" ]; then
  pass "test extract.sh exists"
else
  fail "test extract.sh missing"
fi

# Bash syntax check
if bash -n "$TEST_EXTRACT" 2>/dev/null; then
  pass "test extract.sh: bash syntax OK"
else
  fail "test extract.sh: bash syntax error"
fi

# Validates test_status field
grep -q "test_status" "$TEST_EXTRACT" \
  && pass "test extract.sh: validates test_status field" \
  || fail "test extract.sh: missing test_status validation"

# Validates test_report maxLength
grep -q "2000" "$TEST_EXTRACT" \
  && pass "test extract.sh: enforces test_report max 2000 chars" \
  || fail "test extract.sh: missing report length check"

# Validates tests_added
grep -q "tests_added" "$TEST_EXTRACT" \
  && pass "test extract.sh: validates tests_added field" \
  || fail "test extract.sh: missing tests_added validation"

# Handles empty input
grep -q "empty" "$TEST_EXTRACT" \
  && pass "test extract.sh: handles empty STRUCTURED" \
  || fail "test extract.sh: missing empty input guard"

echo ""
echo "── Retry no-op detection (issue #57, develop.yml) ──"

# Simulate the retry no-op detection logic from develop.yml push step.
# Inputs:
#   $1 = has_retry ("true"|"false")
#   $2 = push_output (contains "Everything up-to-date" or not)
# Output: escalation action
#   "escalate-retry-noop" → apply stage:failed + retry-noop, remove in-development,
#                           skip in-development transition, post escalation comment
#   "proceed-normal"      → normal PR open and in-development transition
simulate_retry_noop_detection() {
  local has_retry="$1"
  local push_output="$2"

  if echo "$push_output" | grep -q "Everything up-to-date"; then
    if [ "$has_retry" = "true" ]; then
      printf '%s' "escalate-retry-noop"
      return
    fi
    # Non-retry up-to-date: unusual but not escalated — proceed
  fi
  printf '%s' "proceed-normal"
}

# retry + up-to-date → escalate
[ "$(simulate_retry_noop_detection "true" "Everything up-to-date")" = "escalate-retry-noop" ] \
  && pass "retry + Everything up-to-date → escalate-retry-noop (stage:failed + retry-noop)" \
  || fail "retry + Everything up-to-date → should escalate"

# retry + new commits → proceed normally
[ "$(simulate_retry_noop_detection "true" "To github.com:akushonkamen/github-auto-dev-scaffold.git\n   abc1234..def5678  claude/issue-37 -> claude/issue-37")" = "proceed-normal" ] \
  && pass "retry + new commits → proceed-normal" \
  || fail "retry + new commits → should proceed normally"

# non-retry + up-to-date → proceed normally (unusual edge case, logged but not escalated)
[ "$(simulate_retry_noop_detection "false" "Everything up-to-date")" = "proceed-normal" ] \
  && pass "non-retry + Everything up-to-date → proceed-normal (logged, not escalated)" \
  || fail "non-retry + Everything up-to-date → should proceed normally"

# non-retry + new commits → proceed normally (standard first-run path)
[ "$(simulate_retry_noop_detection "false" "To github.com:akushonkamen/github-auto-dev-scaffold.git\n   abc1234..def5678  claude/issue-57 -> claude/issue-57")" = "proceed-normal" ] \
  && pass "non-retry + new commits → proceed-normal (standard first-run)" \
  || fail "non-retry + new commits → should proceed normally"

# retry + empty push output → proceed normally (no up-to-date marker)
[ "$(simulate_retry_noop_detection "true" "")" = "proceed-normal" ] \
  && pass "retry + empty push output → proceed-normal (no up-to-date detection)" \
  || fail "retry + empty push output → should proceed normally"

# retry + different push output (fast-forward success message)
SUCCESS_OUTPUT="To github.com:akushonkamen/github-auto-dev-scaffold.git\n * [new branch]      claude/issue-37 -> claude/issue-37"
[ "$(simulate_retry_noop_detection "true" "$SUCCESS_OUTPUT")" = "proceed-normal" ] \
  && pass "retry + push success message → proceed-normal" \
  || fail "retry + push success message → should proceed normally"

# ── Static checks for issue #57 code paths ──

# develop.yml: "Everything up-to-date" detection pattern present
grep -q "Everything up-to-date" "$ROOT/.github/workflows/develop.yml" \
  && pass "develop.yml: 'Everything up-to-date' no-op detection present (issue #57)" \
  || fail "develop.yml: missing 'Everything up-to-date' no-op detection (issue #57)"

# develop.yml: retry-noop label escalation path present
grep -q "retry-noop" "$ROOT/.github/workflows/develop.yml" \
  && pass "develop.yml: retry-noop label escalation path present (issue #57)" \
  || fail "develop.yml: missing retry-noop label escalation (issue #57)"

# develop.yml: stage:failed applied on no-op
grep -q "stage:failed" "$ROOT/.github/workflows/develop.yml" \
  && pass "develop.yml: stage:failed label applied in no-op path (issue #57)" \
  || fail "develop.yml: missing stage:failed in no-op path"

# develop.yml: retry-noop output gates label transition step
grep -q "retry-noop.*true" "$ROOT/.github/workflows/develop.yml" \
  && pass "develop.yml: label transition gated on retry-noop != true (issue #57)" \
  || fail "develop.yml: missing retry-noop gate on label transition"

# develop.yml: HAS_RETRY context fed to push step
grep -q "HAS_RETRY.*steps.retry-ctx.outputs.has-retry" "$ROOT/.github/workflows/develop.yml" \
  && pass "develop.yml: HAS_RETRY fed to pr step from retry-ctx (issue #57)" \
  || fail "develop.yml: missing HAS_RETRY in pr step env"

# labels.yml: retry-noop label defined
grep -q '"retry-noop"' "$ROOT/.github/labels.yml" \
  && pass "labels.yml: 'retry-noop' label present (issue #57)" \
  || fail "labels.yml: 'retry-noop' label MISSING (issue #57)"

# S1: No new permissions added — develop.yml job-level permissions unchanged
if grep -A5 "permissions:" "$ROOT/.github/workflows/develop.yml" | grep -q "contents: write"; then
  pass "develop.yml: contents:write preserved (Module 4 exception, S1)"
else
  fail "develop.yml: contents:write missing (needed for push)"
fi

# S2: No new accepted-by-claude application — only removal preserved
grep -q "remove-label.*accepted-by-claude" "$ROOT/.github/workflows/develop.yml" \
  && pass "develop.yml: only removes accepted-by-claude, never adds (S2 OK)" \
  || fail "develop.yml: accepted-by-claude removal missing"

echo ""
echo "── AC-V2-15 disclosure ──"

# develop.yml PR body includes disclosure preamble
grep -q "AI assistant.*powered by.*operating under" "$ROOT/.github/workflows/develop.yml" \
  && pass "develop.yml: PR body includes AI disclosure preamble (AC-V2-15)" \
  || fail "develop.yml: missing AI disclosure preamble in PR body"

echo ""
echo "=== LAYER 3 RESULTS: $PASS passed, $FAIL failed ==="

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
