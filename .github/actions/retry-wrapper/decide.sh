#!/usr/bin/env bash
# Retry-wrapper decision logic, sourced by both action.yml and test fixtures.
# Keeps the logic in one place so fixtures cannot drift from production.
#
# Arguments (env vars):
#   STATE_FILE   — path to retry-state JSON
#   INPUT_MAX    — fallback max-attempts if state file lacks 'max'
#
# Emits to stdout:
#   key=value lines compatible with GITHUB_OUTPUT format.
#     previous-attempt=N
#     attempt=N
#     max-applied=N
#     should-retry=true|false
#     decision=retry|escalate
#
# Exits non-zero on invalid max-attempts.

retry_wrapper_decide() {
  local state_file="${STATE_FILE:?STATE_FILE required}"
  local input_max="${INPUT_MAX:-3}"

  local prev=0
  local state_max=""
  if [ -f "$state_file" ]; then
    prev=$(jq -r '.attempt // 0' "$state_file" 2>/dev/null || echo 0)
    state_max=$(jq -r '.max // empty' "$state_file" 2>/dev/null || echo "")
  fi

  # Effective max: state file's 'max' wins; else input fallback.
  local eff_max="${state_max:-$input_max}"

  # Numeric validation
  case "$prev" in
    ''|*[!0-9]*) prev=0 ;;
  esac
  case "$eff_max" in
    ''|*[!0-9]*)
      echo "::error::max-attempts must be a positive integer, got '$eff_max'"
      return 1
      ;;
  esac

  local attempt=$((prev + 1))
  local should_retry decision
  if [ "$attempt" -le "$eff_max" ]; then
    should_retry="true"
    decision="retry"
  else
    should_retry="false"
    decision="escalate"
  fi

  printf 'previous-attempt=%s\n' "$prev"
  printf 'attempt=%s\n' "$attempt"
  printf 'max-applied=%s\n' "$eff_max"
  printf 'should-retry=%s\n' "$should_retry"
  printf 'decision=%s\n' "$decision"
}

# If sourced, this is a no-op. If executed directly, run with env-driven args.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  retry_wrapper_decide
fi
