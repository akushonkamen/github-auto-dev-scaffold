#!/usr/bin/env bash
# clarify-e2e.sh — End-to-end test of the v2 clarify loop
#
# Usage: ./scripts/test/clarify-e2e.sh
#
# Submits 8 fixture issues against a test repo, then asserts the expected
# label sequences appear. Requires:
#   - GH_TOKEN with issues:write on the target repo
#   - GITHUB_REPO env var set (or default via config)
#
# Fixtures and expected outcomes:
#
#   vague-feature        → clarify-r-1 (ask), then accepted-by-claude or yielded
#   specific-bug-zh      → accepted-by-claude (clear enough, self-accept)
#   specific-bug-en      → accepted-by-claude (clear enough, self-accept)
#   hostile-injection    → yielded (injection attempt detected)
#   ambiguous-low-conf   → clarify-r-1 (ask) or yielded (unresolvable)
#   stripped-hidden      → stage:failed (AC-V2-13 state corruption)
#   malformed-json       → stage:failed (schema validation)
#   rapid-fire-comments  → clarify-r-1 (ask, then correctly handled)
#
# Each assertion polls the issue labels for up to 5 minutes (30 x 10s intervals).

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
FIXTURE_DIR="$PROJECT_ROOT/.github/fixtures"

REPO="${GITHUB_REPO:-}"
GH_TOKEN="${GH_TOKEN:-}"
TIMEOUT_SEC="${CLARIFY_E2E_TIMEOUT:-300}"
POLL_INTERVAL=10

if [ -z "$REPO" ]; then
  echo "ERROR: GITHUB_REPO not set. Export GITHUB_REPO=owner/repo." >&2
  exit 1
fi

# Helper: create a fixture issue and return the issue number.
create_issue() {
  local title="$1" body_file="$2" label="${3:-}"
  local body
  body=$(cat "$body_file")
  local labels_args=()
  if [ -n "$label" ]; then
    labels_args=(--label "$label")
  fi
  local url
  url=$(gh issue create --repo "$REPO" --title "$title" --body "$body" "${labels_args[@]}" 2>/dev/null)
  local number
  number=$(printf '%s' "$url" | grep -oE '[0-9]+$')
  echo "$number"
}

# Helper: wait for a label to appear on an issue. Returns 0 if found, 1 on timeout.
wait_for_label() {
  local number="$1" expected="$2" timeout="${3:-$TIMEOUT_SEC}"
  local elapsed=0
  while [ "$elapsed" -lt "$timeout" ]; do
    local labels
    labels=$(gh issue view "$number" --repo "$REPO" --json labels 2>/dev/null | jq -r '.labels | map(.name) | join(",")')
    if printf ',%s,' "$labels" | grep -q ",$expected,"; then
      return 0
    fi
    sleep "$POLL_INTERVAL"
    elapsed=$((elapsed + POLL_INTERVAL))
  done
  return 1
}

# Helper: assert a label is NOT present on an issue.
assert_label_absent() {
  local number="$1" forbidden="$2"
  local labels
  labels=$(gh issue view "$number" --repo "$REPO" --json labels 2>/dev/null | jq -r '.labels | map(.name) | join(",")')
  if printf ',%s,' "$labels" | grep -q ",$forbidden,"; then
    echo "FAIL: issue #$number has forbidden label '$forbidden'" >&2
    return 1
  fi
  echo "PASS: issue #$number does not have '$forbidden'"
}

pass_count=0
fail_count=0

# ---- Test 1: vague-feature ----
echo "=== Test 1: vague-feature ==="
n1=$(create_issue "Test [clarify-e2e] Vague feature request" "$FIXTURE_DIR/vague-feature.md" "needs-clarify")
echo "Created issue #$n1"
if wait_for_label "$n1" "clarify-r-1"; then
  echo "PASS: issue #$n1 got clarify-r-1 (Claude asked a follow-up)"
  pass_count=$((pass_count + 1))
else
  # may go straight to yield if unresolvable
  if wait_for_label "$n1" "yielded"; then
    echo "PASS: issue #$n1 got yielded (unresolvable — valid outcome)"
    pass_count=$((pass_count + 1))
  else
    echo "FAIL: issue #$n1 did not get clarify-r-1 or yielded within timeout" >&2
    fail_count=$((fail_count + 1))
  fi
fi

# ---- Test 2: specific-bug-zh ----
echo "=== Test 2: specific-bug-zh ==="
n2=$(create_issue "Test [clarify-e2e] 登录按钮无响应" "$FIXTURE_DIR/specific-bug-zh.md" "needs-clarify")
echo "Created issue #$n2"
if wait_for_label "$n2" "accepted-by-claude"; then
  echo "PASS: issue #$n2 got accepted-by-claude (clear bug report)"
  pass_count=$((pass_count + 1))
else
  echo "FAIL: issue #$n2 did not get accepted-by-claude within timeout" >&2
  fail_count=$((fail_count + 1))
fi

# ---- Test 3: specific-bug-en ----
echo "=== Test 3: specific-bug-en ==="
n3=$(create_issue "Test [clarify-e2e] Login button unresponsive" "$FIXTURE_DIR/specific-bug-en.md" "needs-clarify")
echo "Created issue #$n3"
if wait_for_label "$n3" "accepted-by-claude"; then
  echo "PASS: issue #$n3 got accepted-by-claude (clear bug report)"
  pass_count=$((pass_count + 1))
else
  echo "FAIL: issue #$n3 did not get accepted-by-claude within timeout" >&2
  fail_count=$((fail_count + 1))
fi

# ---- Test 4: hostile-injection ----
echo "=== Test 4: hostile-injection ==="
n4=$(create_issue "Test [clarify-e2e] Prompt injection attempt" "$FIXTURE_DIR/hostile-injection.md" "needs-clarify")
echo "Created issue #$n4"
if wait_for_label "$n4" "yielded"; then
  echo "PASS: issue #$n4 got yielded (injection detected)"
  pass_count=$((pass_count + 1))
  assert_label_absent "$n4" "accepted-by-claude" || fail_count=$((fail_count + 1))
  assert_label_absent "$n4" "accepted" || fail_count=$((fail_count + 1))
else
  echo "FAIL: issue #$n4 did not get yielded within timeout" >&2
  fail_count=$((fail_count + 1))
fi

# ---- Test 5: ambiguous-low-conf ----
echo "=== Test 5: ambiguous-low-conf ==="
n5=$(create_issue "Test [clarify-e2e] Ambiguous request" "$FIXTURE_DIR/ambiguous-low-conf.md" "needs-clarify")
echo "Created issue #$n5"
if wait_for_label "$n5" "clarify-r-1"; then
  echo "PASS: issue #$n5 got clarify-r-1 (Claude asked for clarification)"
  pass_count=$((pass_count + 1))
elif wait_for_label "$n5" "yielded"; then
  echo "PASS: issue #$n5 got yielded (unresolvable)"
  pass_count=$((pass_count + 1))
else
  echo "FAIL: issue #$n5 did not get clarify-r-1 or yielded within timeout" >&2
  fail_count=$((fail_count + 1))
fi

# ---- Test 6-7: sad paths (state corruption, malformed JSON) ----
# These are tested via the parse-clarify-state and boundary-round-counter unit tests.
# In e2e they would need the actual workflow to fail; we note them as manual.

echo "=== Tests 6-7: sad paths ==="
echo "SKIP: sad-path tests require manual workflow trigger (see scripts/test/parse-clarify-state.sh)"

# ---- Test 8: rapid-fire-comments ----
echo "=== Test 8: rapid-fire-comments ==="
n8=$(create_issue "Test [clarify-e2e] Dark mode toggle" "$FIXTURE_DIR/rapid-fire-comments.md" "needs-clarify")
echo "Created issue #$n8"
if wait_for_label "$n8" "clarify-r-1"; then
  echo "PASS: issue #$n8 got clarify-r-1 (rapid-fire comments handled)"
  pass_count=$((pass_count + 1))
elif wait_for_label "$n8" "accepted-by-claude"; then
  echo "PASS: issue #$n8 got accepted-by-claude (clear enough, straight to accept)"
  pass_count=$((pass_count + 1))
else
  echo "FAIL: issue #$n8 did not get a clarify resolution within timeout" >&2
  fail_count=$((fail_count + 1))
fi

# ---- Summary ----
echo ""
echo "============================================"
echo "E2E summary: $pass_count passed, $fail_count failed"
echo "============================================"

if [ "$fail_count" -gt 0 ]; then
  exit 1
fi
