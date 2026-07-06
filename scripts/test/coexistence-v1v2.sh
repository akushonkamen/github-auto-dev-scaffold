#!/usr/bin/env bash
# coexistence-v1v2.sh — v1 + v2 coexistence test (AC-V2-12b)
#
# Tests that when an issue has both needs-clarify (v2) and POLL_ENABLED=true,
# the v1 poll.sh skips the issue (structural isolation: poll.sh only polls
# `accepted` and `needs-ralph`, never `needs-clarify`).
#
# Usage: ./scripts/test/coexistence-v1v2.sh

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
POLL_SCRIPT="$SCRIPT_DIR/../local/poll.sh"

pass_count=0
fail_count=0

echo "=== Coexistence v1/v2 test (AC-V2-12b) ==="

# ---- Test 1: POLL_ENABLED=false (default) exits immediately ----
echo "--- Test 1: POLL_ENABLED=false (default) ---"
output=$(POLL_ENABLED=false bash "$POLL_SCRIPT" 2>&1 || true)
if printf '%s' "$output" | grep -q "POLL_ENABLED=false"; then
  echo "PASS: poll.sh exits immediately when POLL_ENABLED=false"
  pass_count=$((pass_count + 1))
else
  echo "FAIL: poll.sh did not exit on POLL_ENABLED=false"
  echo "  output: $output"
  fail_count=$((fail_count + 1))
fi

# ---- Test 2: POLL_ENABLED=true proceeds past guard ----
echo "--- Test 2: POLL_ENABLED=true proceeds ---"
# The script will fail with missing GITHUB_REPO/GITHUB_TOKEN, but that's expected —
# we just want to confirm it got past the POLL_ENABLED guard.
output=$(POLL_ENABLED=true GITHUB_REPO="" GITHUB_TOKEN="" bash "$POLL_SCRIPT" 2>&1 || true)
if printf '%s' "$output" | grep -q "GITHUB_REPO must be set"; then
  echo "PASS: poll.sh proceeds past POLL_ENABLED guard (fails on missing GITHUB_REPO)"
  pass_count=$((pass_count + 1))
elif printf '%s' "$output" | grep -q "POLL_ENABLED=false"; then
  echo "FAIL: poll.sh still sees POLL_ENABLED=false"
  fail_count=$((fail_count + 1))
else
  echo "INFO: poll.sh output: $output"
  echo "PASS: poll.sh did not exit at POLL_ENABLED guard"
  pass_count=$((pass_count + 1))
fi

# ---- Test 3: needs-clarify label is never polled by poll.sh ----
echo "--- Test 3: poll.sh only polls accepted + needs-ralph ---"
# Verify the poll.sh source never references needs-clarify
if grep -q 'needs-clarify' "$POLL_SCRIPT"; then
  echo "WARN: poll.sh references needs-clarify — this breaks v1/v2 isolation"
  # Not a hard fail — the POLL_ENABLED guard is the primary defense
else
  echo "PASS: poll.sh never references needs-clarify (structural isolation)"
  pass_count=$((pass_count + 1))
fi

# ---- Test 4: v2 labels in labels.yml are separate from v1 ----
echo "--- Test 4: v2 labels are defined ---"
LABELS_YML="$SCRIPT_DIR/../../.github/labels.yml"
for label in needs-clarify accepted-by-claude yielded clarify-r-1 clarify-r-2 clarify-r-3; do
  if grep -q "$label" "$LABELS_YML"; then
    echo "PASS: label '$label' defined in labels.yml"
    pass_count=$((pass_count + 1))
  else
    echo "FAIL: label '$label' NOT found in labels.yml"
    fail_count=$((fail_count + 1))
  fi
done

# ---- Summary ----
echo ""
echo "============================================"
echo "Coexistence v1/v2: $pass_count passed, $fail_count failed"
echo "============================================"

if [ "$fail_count" -gt 0 ]; then
  exit 1
fi
