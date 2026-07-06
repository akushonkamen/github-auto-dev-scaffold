#!/usr/bin/env bash
# Parse LLM engine output for the clarify composite action (Module 3', v2).
#
# Input env var:
#   STRUCTURED — claude-code-action `structured_output` (JSON string), set
#                when --json-schema is passed via claude_args.
#
# Writes to GITHUB_OUTPUT:
#   action            — "ask" | "accept" | "yield"
#   question          — multi-line markdown (heredoc EOF delimiter); empty if action != ask
#   reason            — single-line reason string
#   suggested_language — detected issue language tag (e.g. "zh", "en")
#
# The schema (AC-V2-4b) is enforced by --json-schema upstream; this script
# validates the parsed result explicitly and fails loudly on any deviation.

set -euo pipefail

raw="${STRUCTURED:-}"

if [ -z "$raw" ]; then
  echo "::error::structured_output is empty."
  echo "::error::Verify that --json-schema is in claude_args and the action did not fail."
  exit 1
fi

# Validate: must be a JSON object matching the sealed schema.
if ! printf '%s' "$raw" | jq -e '
  (.action == "ask" or .action == "accept" or .action == "yield")
  and (.reason | type == "string" and length >= 1)
  and (
    (.action != "ask")
    or (.question | type == "string" and length >= 10)
  )
  and has("suggested_language")
' >/dev/null 2>&1; then
  echo "::error::Engine output did not match the {action, question?, reason, suggested_language} schema."
  echo "Raw output (first 500 chars):"
  printf '%s' "$raw" | head -c 500 | sed 's/^/  raw> /'
  echo ""
  exit 1
fi

action="$(printf '%s' "$raw" | jq -r '.action')"
reason="$(printf '%s' "$raw" | jq -r '.reason')"
question="$(printf '%s' "$raw" | jq -r '.question // ""')"
suggested_language="$(printf '%s' "$raw" | jq -r '.suggested_language // "en"')"

echo "action=$action" >> "$GITHUB_OUTPUT"
echo "reason=$reason" >> "$GITHUB_OUTPUT"
echo "suggested_language=$suggested_language" >> "$GITHUB_OUTPUT"

# Multi-line question via heredoc delimiter; empty when action != ask.
{
  echo "question<<QUESTION_EOF"
  printf '%s\n' "$question"
  echo "QUESTION_EOF"
} >> "$GITHUB_OUTPUT"

echo "Parsed clarify output: action=$action language=$suggested_language reason_chars=${#reason}"
