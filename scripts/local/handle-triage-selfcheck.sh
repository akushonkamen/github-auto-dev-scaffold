#!/usr/bin/env bash
# AC-H13 source-level self-check — OUT-OF-LINE so the grep cannot match its
# own exclusion-pattern text (the inline variant was self-referential and
# tripped at every startup; see architect verifier note in progress.txt).
#
# Run this from handle-triage.sh startup. It inspects handle-triage.sh for
# any line that would let the wrapper itself apply a forbidden state label
# (`accepted`, `rejected`, `design-approved`, `needs-info`, `needs-ralph`).
# `stage:failed` (post_failure legitimate) and `triage-done` (transition) are
# excluded because the wrapper legitimately applies them.
#
# Returns 0 if the script is clean, 7 if a forbidden add-label is detected.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="$SCRIPT_DIR/handle-triage.sh"

if [ ! -f "$TARGET" ]; then
  echo "ERROR: $TARGET not found" >&2
  exit 7
fi

# Forbidden state labels — wrapper must never apply these.
FORBIDDEN='(accepted|rejected|design-approved|needs-info|needs-ralph)'

# Allowed-by-design state labels that the wrapper legitimately applies.
ALLOWED='(stage:failed|triage-done)'

# Match any `gh issue edit ... --add-label <X>` line where <X> is forbidden.
# Strip comment lines first. Then exclude allowed labels. Then exclude any
# label variable references (e.g., `--add-label "$comma_labels"`) which are
# checked separately at runtime via the DENY_LIST per-label filter.
matches="$(grep -vE '^\s*#' "$TARGET" \
  | grep -E -- "gh[[:space:]]+issue[[:space:]]+edit.*--add-label[[:space:]]+${FORBIDDEN}\b" \
  | grep -vE -- "--add-label[[:space:]]+(stage:failed|triage-done)\b" \
  || true)"

if [ -n "$matches" ]; then
  echo "ERROR: AC-H13 self-check failed — handle-triage.sh contains a forbidden add-label:" >&2
  printf '%s\n' "$matches" >&2
  echo "" >&2
  echo "Forbidden labels: $FORBIDDEN" >&2
  echo "Allowed-by-design: $ALLOWED (post_failure + transition)" >&2
  exit 7
fi

exit 0
