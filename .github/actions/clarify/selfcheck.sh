#!/usr/bin/env bash
# AC-V2-6 source-level self-check for the clarify composite action.
#
# Mirrors v1's scripts/local/handle-triage-selfcheck.sh (AC-H13) but scoped
# to the clarify dispatch path. The grep is OUT-OF-LINE so it cannot match
# its own exclusion-pattern text (the inline variant would be self-referential).
#
# Run this from clarify-loop.yml preflight. It inspects the dispatch shell
# (clarify-loop.yml's dispatch step inline script, or any future dispatch
# script) for any line that would let the wrapper itself apply a forbidden
# state label via Claude. Allowed: `accepted-by-claude`, `clarify-r-N`,
# `needs-ralph` (max-rounds fallback), `yielded`, `triage-done`, `stage:failed`.
# Forbidden (maintainer-only OR terminal-only): `accepted`, `rejected`,
# `design-approved`, `needs-info`, `needs-clarify`, `triage`.
#
# Returns 0 if the script is clean, 7 if a forbidden add-label is detected.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="$SCRIPT_DIR/../../workflows/clarify-loop.yml"

if [ ! -f "$TARGET" ]; then
  # Workflow not yet created; skip self-check (will run from workflow preflight).
  echo "WARN: $TARGET not found; selfcheck skipped (workflow not yet created)"
  exit 0
fi

# Forbidden state labels — dispatch shell must never apply these on Claude's behalf.
FORBIDDEN='(accepted|rejected|design-approved|needs-info|needs-clarify|triage)'

# Allowed-by-design state labels that the dispatch shell legitimately applies.
ALLOWED='(accepted-by-claude|clarify-r-[0-9]+|needs-ralph|yielded|triage-done|stage:failed)'

# Match any `gh issue edit ... --add-label <X>` line where <X> is forbidden.
# Strip comment lines first. Then exclude allowed labels. Then exclude any
# label variable references (e.g., `--add-label "$computed_label"`) which are
# checked separately at runtime via the DENY_LIST per-label filter.
matches="$(grep -vE '^\s*#' "$TARGET" \
  | grep -E -- "gh[[:space:]]+(issue|pr)[[:space:]]+(edit|create).*--add-label[[:space:]]+${FORBIDDEN}\b" \
  | grep -vE -- "--add-label[[:space:]]+${ALLOWED}\b" \
  || true)"

if [ -n "$matches" ]; then
  echo "ERROR: AC-V2-6 self-check failed — clarify-loop.yml contains a forbidden add-label:" >&2
  printf '%s\n' "$matches" >&2
  echo "" >&2
  echo "Forbidden labels: $FORBIDDEN" >&2
  echo "Allowed-by-design: $ALLOWED (accepted-by-claude, clarify-r-N, needs-ralph, yielded, triage-done, stage:failed)" >&2
  exit 7
fi

exit 0
