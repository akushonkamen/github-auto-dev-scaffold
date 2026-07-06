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

for wf in triage-issue.yml clarify-loop.yml develop.yml; do
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
echo "── AC-V2-3c sentinel marker ──"

grep -q "claude-clarify-round-" "$ROOT/.github/workflows/clarify-loop.yml" \
  && pass "clarify-loop.yml: AC-V2-3c sentinel marker re-entrancy guard" \
  || fail "clarify-loop.yml: AC-V2-3c sentinel marker missing"

echo ""
echo "=== LAYER 3 RESULTS: $PASS passed, $FAIL failed ==="

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
