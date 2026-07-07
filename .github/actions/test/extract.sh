#!/usr/bin/env bash
# Parse Codex engine output for the test composite action.
#
# Input env var:
#   STRUCTURED — Codex output JSON string matching the sealed schema
#
# Writes to GITHUB_OUTPUT:
#   test_status — "passed" | "failed"
#   test_report — multi-line maintainer-readable report (max 2000 chars)
#   tests_added — count of new test files added (integer >= 0)
#
# Codex may emit mixed output (logs + JSON). We extract the first valid JSON
# object matching the sealed schema and validate it explicitly.
set -euo pipefail

raw="${STRUCTURED:-}"

if [ -z "$raw" ]; then
  echo "::error::structured_output is empty."
  echo "::error::Verify that Codex CLI ran successfully and emitted JSON output."
  exit 1
fi

# Validate: must be a JSON object matching the sealed schema.
if ! printf '%s' "$raw" | jq -e '
  (.test_status == "passed" or .test_status == "failed")
  and (.test_report | type == "string" and length <= 2000)
  and (.failures | type == "array")
  and (.tests_added | type == "number" and . >= 0)
' >/dev/null 2>&1; then
  echo "::error::Engine output did not match the {test_status, test_report, failures, tests_added} schema."
  echo "Raw output (first 500 chars):"
  printf '%s' "$raw" | head -c 500 | sed 's/^/  raw> /'
  echo ""
  exit 1
fi

# Extract individual fields.
test_status="$(printf '%s' "$raw" | jq -r '.test_status')"
test_report="$(printf '%s' "$raw" | jq -r '.test_report')"
tests_added="$(printf '%s' "$raw" | jq -r '.tests_added')"

echo "test_status=$test_status" >> "$GITHUB_OUTPUT"
echo "tests_added=$tests_added" >> "$GITHUB_OUTPUT"

# Multi-line output via heredoc delimiter (canonical GITHUB_OUTPUT pattern).
{
  echo "test_report<<TEST_REPORT_EOF"
  printf '%s\n' "$test_report"
  echo "TEST_REPORT_EOF"
} >> "$GITHUB_OUTPUT"

echo "Parsed test output: status=$test_status tests_added=$tests_added"
