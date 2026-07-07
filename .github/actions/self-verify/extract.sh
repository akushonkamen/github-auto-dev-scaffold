#!/usr/bin/env bash
# Parse LLM engine output for the self-verify composite action.
#
# Input env var:
#   STRUCTURED — claude-code-action `structured_output` (JSON string), set
#                when --json-schema is passed via claude_args.
#
# Writes to GITHUB_OUTPUT:
#   verify_status — "passed" | "failed"
#   verify_report — multi-line maintainer-readable report (max 2000 chars)
#   commit_sha    — head commit SHA being verified
#
# claude-code-action enforces the JSON schema via --json-schema, so the
# string should be a single JSON object. We validate explicitly and fail
# loudly on any deviation — silent fallbacks hide integration bugs.
set -euo pipefail

raw="${STRUCTURED:-}"

if [ -z "$raw" ]; then
  echo "::error::structured_output is empty."
  echo "::error::Verify that --json-schema is in claude_args and the action did not fail."
  exit 1
fi

# Validate: must be a JSON object matching the schema.
if ! printf '%s' "$raw" | jq -e '
  (.verify_status == "passed" or .verify_status == "failed")
  and (.verify_report | type == "string" and length <= 2000)
  and (.failures | type == "array")
' >/dev/null 2>&1; then
  echo "::error::Engine output did not match the {verify_status, verify_report, failures} schema."
  echo "Raw output (first 500 chars):"
  printf '%s' "$raw" | head -c 500 | sed 's/^/  raw> /'
  echo ""
  exit 1
fi

# Extract individual fields.
verify_status="$(printf '%s' "$raw" | jq -r '.verify_status')"
verify_report="$(printf '%s' "$raw" | jq -r '.verify_report')"

echo "verify_status=$verify_status" >> "$GITHUB_OUTPUT"

# Multi-line output via heredoc delimiter (canonical GITHUB_OUTPUT pattern).
{
  echo "verify_report<<VERIFY_REPORT_EOF"
  printf '%s\n' "$verify_report"
  echo "VERIFY_REPORT_EOF"
} >> "$GITHUB_OUTPUT"

echo "Parsed self-verify output: status=$verify_status"
