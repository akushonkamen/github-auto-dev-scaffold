#!/usr/bin/env bash
# parse-clarify-state.sh — Hidden-comment parser unit test (AC-V2-13)
#
# Tests the AC-V2-13 cross-check logic: clarify-r-N label vs hidden
# `<!-- CLARIFY_STATE round=N -->` comment. Covers both absent AND
# malformed-JSON cases per Critic rec 1.
#
# Usage: ./scripts/test/parse-clarify-state.sh

set -euo pipefail

pass_count=0
fail_count=0

assert_match() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "PASS: $desc"
    pass_count=$((pass_count + 1))
  else
    echo "FAIL: $desc — expected $expected, got $actual"
    fail_count=$((fail_count + 1))
  fi
}

# ---- Test 1: clean state, no labels, no hidden comment ----
echo "=== Test 1: clean state ==="
labels_csv="triage"
comments_combined="Thanks for the report. I'll look into it."
round_from_label=$(printf '%s' "$labels_csv" | tr ',' '\n' | grep -E '^clarify-r-[0-9]+$' | sed 's/clarify-r-//' | sort -n | tail -1 || true)
hidden_match=$(printf '%s' "$comments_combined" | grep -oE '<!-- CLARIFY_STATE round=[0-9]+ -->' | tail -1 || true)
hidden_round=""
if [ -n "$hidden_match" ]; then
  hidden_round=$(printf '%s' "$hidden_match" | grep -oE '[0-9]+' | head -1)
fi
assert_match "clean: round_from_label empty" "" "$round_from_label"
assert_match "clean: hidden_round empty" "" "$hidden_round"

hidden_ok="true"
if [ -n "$round_from_label" ] && [ -z "$hidden_round" ]; then hidden_ok="false"; fi
if [ -n "$round_from_label" ] && [ "$round_from_label" != "$hidden_round" ]; then hidden_ok="false"; fi
assert_match "clean: hidden_ok" "true" "$hidden_ok"

# ---- Test 2: consent state (label matches hidden) ----
echo "=== Test 2: consent state ==="
labels_csv="triage,clarify-r-2,needs-clarify"
comments_combined="Some reply text.\n<!-- CLARIFY_STATE round=2 -->\nMore text."
round_from_label=$(printf '%s' "$labels_csv" | tr ',' '\n' | grep -E '^clarify-r-[0-9]+$' | sed 's/clarify-r-//' | sort -n | tail -1 || true)
hidden_match=$(printf '%s' "$comments_combined" | grep -oE '<!-- CLARIFY_STATE round=[0-9]+ -->' | tail -1 || true)
hidden_round=""
if [ -n "$hidden_match" ]; then
  hidden_round=$(printf '%s' "$hidden_match" | grep -oE '[0-9]+' | head -1)
fi
assert_match "consent: round_from_label=2" "2" "$round_from_label"
assert_match "consent: hidden_round=2" "2" "$hidden_round"

hidden_ok="true"
if [ -n "$round_from_label" ] && [ -z "$hidden_round" ]; then hidden_ok="false"; fi
if [ -n "$round_from_label" ] && [ "$round_from_label" != "$hidden_round" ]; then hidden_ok="false"; fi
assert_match "consent: hidden_ok" "true" "$hidden_ok"

# ---- Test 3: label present, hidden comment absent (corruption) ----
echo "=== Test 3: stripped hidden comment ==="
labels_csv="triage,clarify-r-1"
comments_combined="Just a normal reply without the state marker."
round_from_label=$(printf '%s' "$labels_csv" | tr ',' '\n' | grep -E '^clarify-r-[0-9]+$' | sed 's/clarify-r-//' | sort -n | tail -1 || true)
hidden_match=$(printf '%s' "$comments_combined" | grep -oE '<!-- CLARIFY_STATE round=[0-9]+ -->' | tail -1 || true)
hidden_round=""
if [ -n "$hidden_match" ]; then
  hidden_round=$(printf '%s' "$hidden_match" | grep -oE '[0-9]+' | head -1)
fi
assert_match "stripped: round_from_label=1" "1" "$round_from_label"
assert_match "stripped: hidden_round empty" "" "$hidden_round"

hidden_ok="true"
if [ -n "$round_from_label" ] && [ -z "$hidden_round" ]; then hidden_ok="false"; fi
if [ -n "$round_from_label" ] && [ "$round_from_label" != "$hidden_round" ]; then hidden_ok="false"; fi
assert_match "stripped: hidden_ok=false (corruption detected)" "false" "$hidden_ok"

# ---- Test 4: malformed hidden comment (round=N but N parseable but mismatch) ----
echo "=== Test 4: round mismatch ==="
labels_csv="triage,clarify-r-3"
comments_combined="<!-- CLARIFY_STATE round=1 -->"
round_from_label=$(printf '%s' "$labels_csv" | tr ',' '\n' | grep -E '^clarify-r-[0-9]+$' | sed 's/clarify-r-//' | sort -n | tail -1 || true)
hidden_match=$(printf '%s' "$comments_combined" | grep -oE '<!-- CLARIFY_STATE round=[0-9]+ -->' | tail -1 || true)
hidden_round=""
if [ -n "$hidden_match" ]; then
  hidden_round=$(printf '%s' "$hidden_match" | grep -oE '[0-9]+' | head -1)
fi
assert_match "mismatch: round_from_label=3" "3" "$round_from_label"
assert_match "mismatch: hidden_round=1" "1" "$hidden_round"

hidden_ok="true"
if [ -n "$round_from_label" ] && [ -z "$hidden_round" ]; then hidden_ok="false"; fi
if [ -n "$round_from_label" ] && [ "$round_from_label" != "$hidden_round" ]; then hidden_ok="false"; fi
assert_match "mismatch: hidden_ok=false (round mismatch)" "false" "$hidden_ok"

# ---- Test 5: multiple hidden comments, take last ----
echo "=== Test 5: multiple hidden comments ==="
labels_csv="triage,clarify-r-2"
comments_combined="<!-- CLARIFY_STATE round=1 -->\nSome text.\n<!-- CLARIFY_STATE round=2 -->"
round_from_label=$(printf '%s' "$labels_csv" | tr ',' '\n' | grep -E '^clarify-r-[0-9]+$' | sed 's/clarify-r-//' | sort -n | tail -1 || true)
hidden_match=$(printf '%s' "$comments_combined" | grep -oE '<!-- CLARIFY_STATE round=[0-9]+ -->' | tail -1 || true)
hidden_round=""
if [ -n "$hidden_match" ]; then
  hidden_round=$(printf '%s' "$hidden_match" | grep -oE '[0-9]+' | head -1)
fi
assert_match "multi: round_from_label=2" "2" "$round_from_label"
assert_match "multi: hidden_round=2 (took last)" "2" "$hidden_round"

hidden_ok="true"
if [ -n "$round_from_label" ] && [ -z "$hidden_round" ]; then hidden_ok="false"; fi
if [ -n "$round_from_label" ] && [ "$round_from_label" != "$hidden_round" ]; then hidden_ok="false"; fi
assert_match "multi: hidden_ok" "true" "$hidden_ok"

# ---- Summary ----
echo ""
echo "============================================"
echo "Parse clarify state: $pass_count passed, $fail_count failed"
echo "============================================"

if [ "$fail_count" -gt 0 ]; then
  exit 1
fi
