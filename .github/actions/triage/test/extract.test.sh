#!/usr/bin/env bash
# Fixture tests for triage extract.sh workload_class handling.
# Covers M3 acceptance criteria:
#   1. trivial fixture → workload_class=trivial
#   2. standard fixture → workload_class=standard
#   3. complex fixture → workload_class=complex
#   4. legacy fixture (no workload_class field) → default 'standard'

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
EXTRACT_SH="$HERE/../extract.sh"
FIXTURES="$HERE/fixtures"

# GITHUB_OUTPUT is required by extract.sh; redirect to a temp file.
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

run_fixture() {
  local fixture="$1"
  local out="$TMPDIR/$(basename "$fixture" .json).output"
  GITHUB_OUTPUT="$out" STRUCTURED="$(cat "$fixture")" bash "$EXTRACT_SH" 2>&1
}

echo "Scenario 1: trivial fixture"
out1="$TMPDIR/trivial.output"
GITHUB_OUTPUT="$out1" STRUCTURED="$(cat "$FIXTURES/trivial.json")" bash "$EXTRACT_SH"
assert_eq "workload_class" "trivial" "$(grep '^workload_class=' "$out1" | cut -d= -f2)"
assert_eq "decision"       "work"     "$(grep '^decision=' "$out1" | cut -d= -f2)"

echo "Scenario 2: standard fixture"
out2="$TMPDIR/standard.output"
GITHUB_OUTPUT="$out2" STRUCTURED="$(cat "$FIXTURES/standard.json")" bash "$EXTRACT_SH"
assert_eq "workload_class" "standard" "$(grep '^workload_class=' "$out2" | cut -d= -f2)"

echo "Scenario 3: complex fixture"
out3="$TMPDIR/complex.output"
GITHUB_OUTPUT="$out3" STRUCTURED="$(cat "$FIXTURES/complex.json")" bash "$EXTRACT_SH"
assert_eq "workload_class" "complex" "$(grep '^workload_class=' "$out3" | cut -d= -f2)"

echo "Scenario 4: legacy fixture (no workload_class field → default 'standard')"
out4="$TMPDIR/legacy.output"
GITHUB_OUTPUT="$out4" STRUCTURED="$(cat "$FIXTURES/legacy-no-workload-class.json")" bash "$EXTRACT_SH"
assert_eq "workload_class default" "standard" "$(grep '^workload_class=' "$out4" | cut -d= -f2)"

echo "Scenario 5: invalid workload_class value (coerce to 'standard' + warning)"
out5="$TMPDIR/invalid.output"
log5="$TMPDIR/invalid.log"
# extract.sh emits ::warning:: to stdout (consistent with its ::error:: usage).
# Capture full output (stdout+stderr) to a log file; GITHUB_OUTPUT still receives the parsed fields.
GITHUB_OUTPUT="$out5" STRUCTURED="$(cat "$FIXTURES/invalid-workload-class.json")" bash "$EXTRACT_SH" >"$log5" 2>&1 || true
assert_eq "invalid coerced" "standard" "$(grep '^workload_class=' "$out5" | cut -d= -f2)"
if grep -q "::warning::" "$log5"; then
  printf '  ✓ warning emitted for invalid value\n'
  PASS=$((PASS + 1))
else
  printf '  ✗ warning not emitted for invalid value\n    log:\n%s\n' "$(cat "$log5")"
  FAIL=$((FAIL + 1))
fi

echo "Scenario 6: null workload_class (treated as missing → default 'standard')"
out6="$TMPDIR/null.output"
GITHUB_OUTPUT="$out6" STRUCTURED="$(cat "$FIXTURES/null-workload-class.json")" bash "$EXTRACT_SH"
assert_eq "null → default" "standard" "$(grep '^workload_class=' "$out6" | cut -d= -f2)"

echo ""
echo "Summary: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
