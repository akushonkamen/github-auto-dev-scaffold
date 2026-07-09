#!/usr/bin/env bash
# Parse LLM engine output for the triage composite action.
#
# Input env var:
#   STRUCTURED — claude-code-action `structured_output` (JSON string), set
#                when --json-schema is passed via claude_args.
#
# Writes to GITHUB_OUTPUT:
#   decision         — "reply" | "work"
#   comment_body     — multi-line markdown (heredoc EOF delimiter)
#   suggested_labels — comma-separated string (empty if none)
#   confidence       — float in [0,1]
#   workload_class   — "trivial" | "standard" | "complex" (M3, defaults to "standard")
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
  (.decision == "reply" or .decision == "work")
  and (.comment_body | type == "string" and length >= 10)
  and (.suggested_labels | type == "array")
  and (.confidence | type == "number" and . >= 0 and . <= 1)
' >/dev/null 2>&1; then
  echo "::error::Engine output did not match the {decision, comment_body, suggested_labels, confidence} schema."
  echo "Raw output (first 500 chars):"
  printf '%s' "$raw" | head -c 500 | sed 's/^/  raw> /'
  echo ""
  exit 1
fi

# Extract individual fields.
decision="$(printf '%s' "$raw" | jq -r '.decision')"
comment_body="$(printf '%s' "$raw" | jq -r '.comment_body')"
suggested_labels="$(printf '%s' "$raw" | jq -r '.suggested_labels | if length == 0 then "" else join(",") end')"
confidence="$(printf '%s' "$raw" | jq -r '.confidence')"
# M3: workload_class is optional in the schema; default to "standard" if absent.
# This keeps backwards compatibility with engines that haven't picked up the
# new field yet. M8 replaces AUTO_ACCEPT_ENABLED with this classification.
workload_class="$(printf '%s' "$raw" | jq -r '.workload_class // "standard"')"
case "$workload_class" in
  trivial|standard|complex) ;;
  *)
    echo "::warning::workload_class has unexpected value '$workload_class'; coercing to 'standard'"
    workload_class="standard"
    ;;
esac

echo "decision=$decision"                 >> "$GITHUB_OUTPUT"
echo "confidence=$confidence"             >> "$GITHUB_OUTPUT"
echo "suggested_labels=$suggested_labels" >> "$GITHUB_OUTPUT"
echo "workload_class=$workload_class"     >> "$GITHUB_OUTPUT"

# Multi-line output via heredoc delimiter (canonical GITHUB_OUTPUT pattern).
{
  echo "comment_body<<COMMENT_BODY_EOF"
  printf '%s\n' "$comment_body"
  echo "COMMENT_BODY_EOF"
} >> "$GITHUB_OUTPUT"

echo "Parsed triage output: decision=$decision confidence=$confidence labels=[$suggested_labels] workload_class=$workload_class"
