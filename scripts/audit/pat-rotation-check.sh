#!/usr/bin/env bash
# pat-rotation-check.sh — PAT rotation sentinel check (AC-V2-14)
#
# Reads docs/security/PAT_ROTATION_DUE.md for an ISO-8601 date and exits
# non-zero if that date is in the past. Used as a pre-commit hook or CI
# scheduled check to enforce the quarterly rotation policy.
#
# Sentinel file format: single ISO-8601 date, e.g. "2026-10-06"
#
# Usage: ./scripts/audit/pat-rotation-check.sh

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SENTINEL="$REPO_ROOT/docs/security/PAT_ROTATION_DUE.md"

if [ ! -f "$SENTINEL" ]; then
  echo "FAIL: PAT rotation sentinel not found at docs/security/PAT_ROTATION_DUE.md"
  echo "Create it with a single ISO-8601 date (e.g. '2026-10-06')"
  exit 1
fi

DUE_DATE=$(head -1 "$SENTINEL" | tr -d '[:space:]')
if [ -z "$DUE_DATE" ]; then
  echo "FAIL: PAT_ROTATION_DUE.md is empty — expected an ISO-8601 date"
  exit 1
fi

# Validate ISO-8601 format (YYYY-MM-DD)
if ! printf '%s' "$DUE_DATE" | grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'; then
  echo "FAIL: PAT_ROTATION_DUE.md does not contain a valid ISO-8601 date (YYYY-MM-DD): $DUE_DATE"
  exit 1
fi

# Compare dates using epoch seconds (cross-platform)
if [[ "$(uname -s)" == "Darwin" ]]; then
  due_epoch=$(date -j -f '%Y-%m-%d' "$DUE_DATE" '+%s' 2>/dev/null || echo 0)
  now_epoch=$(date '+%s')
  # Guard against bogus dates (>1 year in future)
  year_future=$((now_epoch + 31536000))
  if [ "$due_epoch" -eq 0 ]; then
    echo "FAIL: could not parse date from PAT_ROTATION_DUE.md: $DUE_DATE"
    exit 1
  fi
  if [ "$due_epoch" -gt "$year_future" ]; then
    echo "FAIL: PAT_ROTATION_DUE.md date is more than 1 year in future: $DUE_DATE"
    exit 1
  fi
else
  due_epoch=$(date -d "$DUE_DATE" '+%s' 2>/dev/null || echo 0)
  now_epoch=$(date '+%s')
fi

if [ "$due_epoch" -lt "$now_epoch" ]; then
  echo "FAIL: PAT rotation is past due (due: $DUE_DATE, now: $(date '+%Y-%m-%d'))"
  echo "Rotate CLAUDE_DEV_PAT and update docs/security/PAT_ROTATION_DUE.md"
  exit 1
fi

days_left=$(((due_epoch - now_epoch) / 86400))
echo "PASS: PAT rotation is current — $days_left day(s) until next rotation (due: $DUE_DATE)"
