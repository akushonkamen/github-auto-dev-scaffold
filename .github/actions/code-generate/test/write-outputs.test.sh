#!/usr/bin/env bash
# Regression test for the Module 4 "Resolve inputs" $GITHUB_OUTPUT contract.
#
# Issue #151: the prior verify/test/review report is a full markdown comment
# containing "| Field | Value |" table rows. Emitting it as a single-line
# `prior-test-report=$value` made GitHub's $GITHUB_OUTPUT file-command parser
# reject each table row as "Invalid format '| Field | Value |'" (run
# 29264389854), which killed every verify/test/review retry at the Resolve step.
#
# code-generate.yml now emits prior-test-report with the heredoc syntax (unique
# PRIOR_TEST_REPORT_EOF delimiter) INLINE, then calls
# code_generate_validate_github_output as defense-in-depth. This test pins both
# halves of that contract:
#   1. Every emitted line is valid $GITHUB_OUTPUT syntax (0 "invalid" lines) and
#      the multi-line prior-test-report round-trips byte-for-byte — for a table
#      report, an empty report, and a report containing a bare "EOF" line.
#   2. code_generate_validate_github_output ACCEPTS that well-formed emission and
#      REJECTS the pre-fix single-line emission (proving it would catch the #151
#      regression at the source instead of three jobs later).

set -uo pipefail
# Note: no `set -e` — the negative scenario deliberately produces invalid output
# and we drive pass/fail via explicit counters.

HERE="$(cd "$(dirname "$0")" && pwd)"
LIB="$HERE/../lib/write-outputs.sh"
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

# Extract a key's value from a $GITHUB_OUTPUT-style file, supporting both
# single-line `key=value` and heredoc `key<<DELIM\n...\nDELIM`. Multi-line
# values are reproduced verbatim (newline-joined).
gh_get() {
  local key="$1" file="$2"
  awk -v want="$key" '
    {
      if (in_h) {
        if ($0 == delim) { if (cur == want && !done) { sub(/\n$/, "", val); printf "%s", val; done = 1 }; in_h = 0 }
        else val = val $0 "\n"
        next
      }
      if ($0 ~ /^([A-Za-z_][A-Za-z0-9_-]*)<</) {
        cur = $0; sub(/<<.*/, "", cur)
        delim = $0; sub(/^([A-Za-z_][A-Za-z0-9_-]*)<<=?/, "", delim)
        val = ""; in_h = 1
        next
      }
      if ($0 ~ /^([A-Za-z_][A-Za-z0-9_-]*)=/) {
        k = $0; sub(/=.*/, "", k)
        if (k == want && !done) { v = $0; sub(/^[^=]*=/, "", v); printf "%s", v; done = 1 }
        next
      }
    }
  ' "$file"
}

# Count lines GitHub's file-command parser would reject as "Invalid format"
# (any line that is neither a key=value, a heredoc header, a heredoc body line,
# nor a heredoc delimiter).
gh_invalid_count() {
  local file="$1"
  awk '
    {
      if (in_h) { if ($0 == delim) in_h = 0; next }
      else if ($0 ~ /^([A-Za-z_][A-Za-z0-9_-]*)<</) {
        delim = $0; sub(/^([A-Za-z_][A-Za-z0-9_-]*)<<=?/, "", delim); in_h = 1; next
      }
      else if ($0 ~ /^([A-Za-z_][A-Za-z0-9_-]*)=/) { next }
      else bad++
    }
    END { print (bad + 0) }
  ' "$file"
}

# Emit the Resolve outputs the way code-generate.yml does — INLINE with the
# heredoc syntax and the unique PRIOR_TEST_REPORT_EOF delimiter — so the test
# pins the exact production emission contract rather than a parallel copy.
emit() {
  issue_number="$1"; head_branch="$2"; base_branch="$3"
  issue_language="$4"; retry_attempt="$5"; prior_test_report="$6"
  : > "$GITHUB_OUTPUT"
  {
    echo "issue-number=$issue_number"
    echo "head-branch=$head_branch"
    echo "base-branch=$base_branch"
    echo "issue-language=$issue_language"
    echo "retry-attempt=$retry_attempt"
    echo "prior-test-report<<PRIOR_TEST_REPORT_EOF"
    printf '%s\n' "$prior_test_report"
    echo "PRIOR_TEST_REPORT_EOF"
  } >> "$GITHUB_OUTPUT"
}

# shellcheck source=/dev/null
. "$LIB"

GITHUB_OUTPUT="$TMPDIR/out.txt"

echo "Scenario 1: multi-line report with '| Field | Value |' table (issue #151 repro)"
# No trailing newline: keeps the round-trip byte-exact (the canonical
# `printf '%s\n'` adds exactly one terminator; $() strips it on read-back).
report1=$'## Failure summary\n\n| Field | Value |\n|---|---|\n| Retry | 2 of 3 |\n| Prior workflow run | https://example.com/actions/runs/29264389854 |\n| Retry label | test:retry-2 |'
emit "151" "claude/issue-151-multi-line-pr" "dev" "en" "2" "$report1"
assert_eq "no invalid-format lines"     "0"                       "$(gh_invalid_count "$GITHUB_OUTPUT")"
assert_eq "prior-test-report round-trips" "$report1"              "$(gh_get prior-test-report "$GITHUB_OUTPUT")"
assert_eq "issue-number"                "151"                     "$(gh_get issue-number "$GITHUB_OUTPUT")"
assert_eq "head-branch"                 "claude/issue-151-multi-line-pr" "$(gh_get head-branch "$GITHUB_OUTPUT")"
assert_eq "base-branch"                 "dev"                     "$(gh_get base-branch "$GITHUB_OUTPUT")"
assert_eq "issue-language"              "en"                      "$(gh_get issue-language "$GITHUB_OUTPUT")"
assert_eq "retry-attempt"               "2"                       "$(gh_get retry-attempt "$GITHUB_OUTPUT")"

echo "Scenario 2: empty report (workflow_dispatch with no prior feedback)"
emit "42" "claude/issue-42-y" "dev" "zh" "0" ""
assert_eq "no invalid-format lines"     "0"                       "$(gh_invalid_count "$GITHUB_OUTPUT")"
assert_eq "prior-test-report empty"     ""                        "$(gh_get prior-test-report "$GITHUB_OUTPUT")"
assert_eq "retry-attempt default"       "0"                       "$(gh_get retry-attempt "$GITHUB_OUTPUT")"

echo "Scenario 3: report containing a bare 'EOF' line (delimiter-collision guard)"
report3=$'line one\nEOF\nline three'
emit "7" "claude/issue-7-z" "dev" "en" "1" "$report3"
assert_eq "no invalid-format lines"     "0"                       "$(gh_invalid_count "$GITHUB_OUTPUT")"
assert_eq "round-trips bare EOF inside" "$report3"                "$(gh_get prior-test-report "$GITHUB_OUTPUT")"

echo "Scenario 4 (negative): pre-fix single-line emission IS flagged invalid"
# Simulate the #151 bug: `echo "prior-test-report=$report"` lets the shell's
# embedded newlines spill the table rows out as bare lines.
: > "$GITHUB_OUTPUT"
printf 'prior-test-report=%s\n' "$report1"
bad_buggy="$(gh_invalid_count "$GITHUB_OUTPUT")"
if [ "$bad_buggy" -gt 0 ]; then
  printf '  ✓ pre-fix emission flagged invalid (%s line(s), e.g. "| Field | Value |")\n' "$bad_buggy"
  PASS=$((PASS + 1))
else
  printf '  ✗ pre-fix emission was NOT flagged — test cannot detect #151\n'
  FAIL=$((FAIL + 1))
fi

echo "Scenario 5: validator ACCEPTS well-formed emission (issue #151 defense-in-depth)"
# code_generate_validate_github_output mirrors GitHub's file-command parser: it
# must return 0 on the inline heredoc emission so the Resolve step proceeds.
emit "151" "claude/issue-151-multi-line-pr" "dev" "en" "2" "$report1"
code_generate_validate_github_output && v=0 || v=1
assert_eq "validator returns 0 on valid output" "0" "$v"

echo "Scenario 6 (negative): validator REJECTS pre-fix single-line emission"
# The same malformed output scenario 4 proves the awk counter flags: the
# validator (an independent, bash-based parser) must ALSO reject it, so the
# Resolve step would fail at the source instead of three jobs later.
: > "$GITHUB_OUTPUT"
printf 'prior-test-report=%s\n' "$report1"
code_generate_validate_github_output && v=0 || v=1
assert_eq "validator returns non-zero on invalid output" "1" "$v"

echo "Scenario 7: validator ACCEPTS empty prior-test-report (workflow_run path)"
emit "42" "claude/issue-42-y" "dev" "en" "0" ""
code_generate_validate_github_output && v=0 || v=1
assert_eq "validator returns 0 on empty report" "0" "$v"

echo
echo "Passed: $PASS  Failed: $FAIL"
[ "$FAIL" -eq 0 ]
