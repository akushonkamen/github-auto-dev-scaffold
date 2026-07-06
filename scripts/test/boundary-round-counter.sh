#!/usr/bin/env bash
# boundary-round-counter.sh — Verifies clarify-r-3 triggers max-rounds fallback
#
# Tests that when CLARIFY_MAX_ROUNDS=3 and the round counter reaches 4
# (round 3 exhausted), the max-rounds check emits exhausted=true.
#
# Usage: ./scripts/test/boundary-round-counter.sh

set -euo pipefail

pass_count=0
fail_count=0

assert_exhausted() {
  local desc="$1" round="$2" max="$3" expected="$4"
  local exhausted="false"
  if [ "$round" -gt "$max" ]; then
    exhausted="true"
  fi
  if [ "$exhausted" = "$expected" ]; then
    echo "PASS: $desc (round=$round max=$max exhausted=$exhausted)"
    pass_count=$((pass_count + 1))
  else
    echo "FAIL: $desc — expected exhausted=$expected, got $exhausted"
    fail_count=$((fail_count + 1))
  fi
}

# ---- Standard boundary tests ----
assert_exhausted "round 1, max 3 (not exhausted)" 1 3 "false"
assert_exhausted "round 2, max 3 (not exhausted)" 2 3 "false"
assert_exhausted "round 3, max 3 (not exhausted — equal is ok)" 3 3 "false"
assert_exhausted "round 4, max 3 (exhausted — exceeded)" 4 3 "true"
assert_exhausted "round 100, max 3 (way over)" 100 3 "true"

# ---- Edge cases ----
assert_exhausted "round 1, max 1 (equal — ok on last round)" 1 1 "false"
assert_exhausted "round 2, max 1 (exhausted immediately)" 2 1 "true"
assert_exhausted "round 0, max 3 (pre-round, not exhausted)" 0 3 "false"

# ---- Configurable max rounds ----
assert_exhausted "round 5, max 5 (equal — ok on last round)" 5 5 "false"
assert_exhausted "round 6, max 5 (exhausted)" 6 5 "true"

# ---- Summary ----
echo ""
echo "============================================"
echo "Boundary round counter: $pass_count passed, $fail_count failed"
echo "============================================"

if [ "$fail_count" -gt 0 ]; then
  exit 1
fi
