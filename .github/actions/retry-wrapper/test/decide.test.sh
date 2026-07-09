#!/usr/bin/env bash
# Fixture tests for retry-wrapper decide logic.
# Covers three scenarios per M2 acceptance criteria:
#   1. First attempt (no state file → attempt=1, decision=retry)
#   2. Mid-retry (state file attempt=2, max=3 → attempt=3, decision=retry)
#   3. Exhausted (state file attempt=3, max=3 → attempt=4, decision=escalate)
# Plus two edge cases:
#   4. State max overrides input max
#   5. Invalid max-attempts → exit non-zero

set -uo pipefail
# Note: we do NOT set -e because we expect scenario 5 to exit non-zero.

HERE="$(cd "$(dirname "$0")" && pwd)"
DECIDE_SH="$HERE/../decide.sh"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

PASS=0
FAIL=0

assert_eq() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    printf '  ✓ %s\n' "$label"
    PASS=$((PASS + 1))
  else
    printf '  ✗ %s\n    expected: %s\n    actual:   %s\n' "$label" "$expected" "$actual"
    FAIL=$((FAIL + 1))
  fi
}

run_decide() {
  # Returns output as stdout; captures exit code via $decide_exit.
  STATE_FILE="$1" INPUT_MAX="$2" bash -c "source '$DECIDE_SH' && retry_wrapper_decide"
}

echo "Scenario 1: first attempt (no state file)"
state1="$TMPDIR/no-state.json"
output1=$(run_decide "$state1" "3") || true
assert_eq "previous-attempt" "0"        "$(printf '%s' "$output1" | grep '^previous-attempt=' | cut -d= -f2)"
assert_eq "attempt"          "1"        "$(printf '%s' "$output1" | grep '^attempt=' | cut -d= -f2)"
assert_eq "max-applied"      "3"        "$(printf '%s' "$output1" | grep '^max-applied=' | cut -d= -f2)"
assert_eq "should-retry"     "true"     "$(printf '%s' "$output1" | grep '^should-retry=' | cut -d= -f2)"
assert_eq "decision"         "retry"    "$(printf '%s' "$output1" | grep '^decision=' | cut -d= -f2)"

echo "Scenario 2: mid-retry (attempt=2, max=3)"
state2="$TMPDIR/mid.json"
echo '{"attempt": 2, "max": 3, "last_failure": "2026-07-09T10:00:00Z"}' > "$state2"
output2=$(run_decide "$state2" "3") || true
assert_eq "previous-attempt" "2"        "$(printf '%s' "$output2" | grep '^previous-attempt=' | cut -d= -f2)"
assert_eq "attempt"          "3"        "$(printf '%s' "$output2" | grep '^attempt=' | cut -d= -f2)"
assert_eq "max-applied"      "3"        "$(printf '%s' "$output2" | grep '^max-applied=' | cut -d= -f2)"
assert_eq "should-retry"     "true"     "$(printf '%s' "$output2" | grep '^should-retry=' | cut -d= -f2)"
assert_eq "decision"         "retry"    "$(printf '%s' "$output2" | grep '^decision=' | cut -d= -f2)"

echo "Scenario 3: exhausted (attempt=3, max=3)"
state3="$TMPDIR/exhausted.json"
echo '{"attempt": 3, "max": 3, "last_failure": "2026-07-09T10:00:00Z"}' > "$state3"
output3=$(run_decide "$state3" "3") || true
assert_eq "previous-attempt" "3"        "$(printf '%s' "$output3" | grep '^previous-attempt=' | cut -d= -f2)"
assert_eq "attempt"          "4"        "$(printf '%s' "$output3" | grep '^attempt=' | cut -d= -f2)"
assert_eq "max-applied"      "3"        "$(printf '%s' "$output3" | grep '^max-applied=' | cut -d= -f2)"
assert_eq "should-retry"     "false"    "$(printf '%s' "$output3" | grep '^should-retry=' | cut -d= -f2)"
assert_eq "decision"         "escalate" "$(printf '%s' "$output3" | grep '^decision=' | cut -d= -f2)"

echo "Scenario 4: state max overrides input max"
state4="$TMPDIR/override.json"
echo '{"attempt": 0, "max": 5}' > "$state4"
output4=$(run_decide "$state4" "3") || true
assert_eq "max-applied (state wins)" "5" "$(printf '%s' "$output4" | grep '^max-applied=' | cut -d= -f2)"
assert_eq "decision (1 ≤ 5)" "retry" "$(printf '%s' "$output4" | grep '^decision=' | cut -d= -f2)"

echo "Scenario 5: invalid max-attempts → exit non-zero"
state5="$TMPDIR/empty.json"
echo '{}' > "$state5"
output5=$(STATE_FILE="$state5" INPUT_MAX="not-a-number" bash -c "source '$DECIDE_SH' && retry_wrapper_decide" 2>/dev/null) || true
exit5=$?
# Decide should have exited non-zero. The '|| true' above masks it; check via output emptiness.
# Re-run without masking to capture exit code explicitly.
STATE_FILE="$state5" INPUT_MAX="not-a-number" bash -c "source '$DECIDE_SH' && retry_wrapper_decide" >/dev/null 2>&1
exit5=$?
if [ "$exit5" -ne 0 ]; then
  printf '  ✓ invalid max-attempts rejected (exit=%s)\n' "$exit5"
  PASS=$((PASS + 1))
else
  printf '  ✗ invalid max-attempts should have failed\n'
  FAIL=$((FAIL + 1))
fi

echo ""
echo "Summary: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
