#!/usr/bin/env bash
# Parse LLM engine output for the triage composite action.
#
# Input env vars:
#   CLAUDE_RESPONSE — text from claude-code-action `response` output
#   CODEX_OUTPUT    — text from codex-action `output` output
#
# Writes to GITHUB_OUTPUT:
#   decision         — "reply" | "work"
#   comment_body     — multi-line markdown (heredoc EOF delimiter)
#   suggested_labels — comma-separated string (empty if none)
#   confidence       — float in [0,1]
#
# Both engine actions enforce the JSON schema via `output_schema`, so the
# raw text is expected to be a single JSON object. We validate explicitly
# and fail loudly on any deviation — silent fallbacks hide integration bugs.
set -euo pipefail

# Pick whichever engine produced output.
raw=""
if [ -n "${CLAUDE_RESPONSE:-}" ]; then raw="$CLAUDE_RESPONSE"; fi
if [ -n "${CODEX_OUTPUT:-}" ];    then raw="$CODEX_OUTPUT";    fi

if [ -z "$raw" ]; then
  echo "::error::No engine output. claude-code-action exposes 'response'; codex-action exposes 'output'."
  echo "::error::If both are empty, the underlying engine action failed or its output name changed."
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
  echo "If the engine wrapped the JSON in prose, verify output_schema is still set on the action call."
  exit 1
fi

# Extract individual fields.
decision="$(printf '%s' "$raw" | jq -r '.decision')"
comment_body="$(printf '%s' "$raw" | jq -r '.comment_body')"
suggested_labels="$(printf '%s' "$raw" | jq -r '.suggested_labels | if length == 0 then "" else join(",") end')"
confidence="$(printf '%s' "$raw" | jq -r '.confidence')"

echo "decision=$decision"                >> "$GITHUB_OUTPUT"
echo "confidence=$confidence"            >> "$GITHUB_OUTPUT"
echo "suggested_labels=$suggested_labels" >> "$GITHUB_OUTPUT"

# Multi-line output via heredoc delimiter (canonical GITHUB_OUTPUT pattern).
{
  echo "comment_body<<COMMENT_BODY_EOF"
  printf '%s\n' "$comment_body"
  echo "COMMENT_BODY_EOF"
} >> "$GITHUB_OUTPUT"

echo "Parsed triage output: decision=$decision confidence=$confidence labels=[$suggested_labels]"
