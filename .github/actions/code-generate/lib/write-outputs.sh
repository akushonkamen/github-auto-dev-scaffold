#!/usr/bin/env bash
# Validate the Module 4 "Resolve inputs" step's $GITHUB_OUTPUT (issue #151).
#
# Sourced by:
#   - .github/workflows/code-generate.yml  (the resolve step — defense-in-depth)
#   - .github/actions/code-generate/test/write-outputs.test.sh
#
# code-generate.yml emits its Resolve outputs INLINE — including the multi-line
# prior-test-report via the heredoc syntax
# (`prior-test-report<<PRIOR_TEST_REPORT_EOF` … `PRIOR_TEST_REPORT_EOF`) — so
# issue #151's prescribed fix is visible in the workflow file itself rather than
# hidden behind a helper call. This validator is the defense-in-depth backstop:
# it re-parses $GITHUB_OUTPUT and fails LOUDLY at the source if any emitted line
# is malformed, instead of letting the retry die three jobs later on a cryptic
# "Invalid format" parser error (run 29264389854: a markdown "| Field | Value |"
# table row spilled out of a bare `prior-test-report=$value` and broke GitHub's
# file-command parser, blocking every verify/test/review retry at Resolve).
#
# Reads $GITHUB_OUTPUT (a fresh per-step file the Actions runner provides, or a
# temp file the unit test points at). No arguments. Returns 0 when every line is
# well-formed (a `key=value` pair or a complete `key<<DELIM` … `DELIM` heredoc
# block), 1 otherwise.
code_generate_validate_github_output() {
  [ -n "${GITHUB_OUTPUT:-}" ] && [ -f "$GITHUB_OUTPUT" ] || return 0
  local re_heredoc='^[A-Za-z_][A-Za-z0-9_-]*=?<<(.*$)'
  local re_kv='^[A-Za-z_][A-Za-z0-9_-]*='
  local in_h=0 delim="" bad=0 line
  while IFS= read -r line || [ -n "$line" ]; do
    if [ "$in_h" = "1" ]; then
      [ "$line" = "$delim" ] && in_h=0
      continue
    fi
    if [[ "$line" =~ $re_heredoc ]]; then
      delim="${BASH_REMATCH[1]}"
      in_h=1
    elif [[ "$line" =~ $re_kv ]]; then
      :
    else
      bad=$((bad + 1))
      printf '::error::Malformed $GITHUB_OUTPUT line (issue #151 regression): %s\n' "${line:0:120}" >&2
    fi
  done < "$GITHUB_OUTPUT"
  if [ "$bad" -gt 0 ]; then
    printf '::error::%s malformed $GITHUB_OUTPUT line(s) — Resolve step aborting before GitHub parser rejection (Invalid format).\n' "$bad" >&2
    return 1
  fi
}
