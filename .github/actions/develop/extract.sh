#!/usr/bin/env bash
# Parse LLM engine output for the develop composite action.
#
# PR #143: GLM passthrough does not reliably honor --json-schema strict
# mode. Claude/GLM now emits the summary/language as a single-line JSON
# object in the assistant text (read from execution_file). This script
# tolerates:
#   (a) pure JSON
#   (b) prose + JSON mixed
#   (c) ```json``` fenced JSON
#   (d) first-{ ... last-} substring
# If all extraction strategies fail, we fall back to safe defaults so the
# caller workflow can still push the branch and open the PR — the AI's
# commits on the head branch are valuable even when the structured summary
# cannot be recovered.
#
# Input env var:
#   STRUCTURED    — assistant text from execution_file (result or last assistant msg)
#   ISSUE_LANG    — fallback language when AI omits the field
#
# Writes to GITHUB_OUTPUT:
#   summary       — one-paragraph change summary
#   pr-language   — zh|en|ja|ko|es|fr|de|ru|pt|other
set -euo pipefail

raw="${STRUCTURED:-}"
fallback_lang="${ISSUE_LANG:-en}"

if [ -z "$raw" ]; then
  echo "::warning::STRUCTURED env is empty — using default summary."
  echo "summary=(Claude did not emit a structured summary; inspect the diff on the branch.)" >> "$GITHUB_OUTPUT"
  echo "pr-language=${fallback_lang}" >> "$GITHUB_OUTPUT"
  exit 0
fi

extract_json() {
  local input="$1"
  # Strategy 1: ```json ... ``` fenced block (last match wins)
  local block
  block=$(printf '%s' "$input" \
    | awk '/```json/{flag=1;next}/```/{flag=0}flag' \
    | tr -d '\n' \
    | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
  if [ -n "$block" ] && printf '%s' "$block" | jq -e . >/dev/null 2>&1; then
    printf '%s' "$block"
    return 0
  fi
  # Strategy 2: first-{ ... last-} substring
  block=$(printf '%s' "$input" \
    | sed -n 's/.*\({.*}\).*/\1/p' \
    | tr -d '\n' \
    | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
  if [ -n "$block" ] && printf '%s' "$block" | jq -e . >/dev/null 2>&1; then
    printf '%s' "$block"
    return 0
  fi
  # Strategy 3: input is already pure JSON
  if printf '%s' "$input" | jq -e . >/dev/null 2>&1; then
    printf '%s' "$input" | tr -d '\n'
    return 0
  fi
  return 1
}

json=$(extract_json "$raw") || json=""

if [ -z "$json" ]; then
  echo "::warning::All JSON extraction strategies failed. Using default summary."
  echo "Raw output (first 500 chars):"
  printf '%s' "$raw" | head -c 500 | sed 's/^/  raw> /'
  echo ""
  echo "summary=(Claude did not emit a parseable summary; inspect the diff on the branch.)" >> "$GITHUB_OUTPUT"
  echo "pr-language=${fallback_lang}" >> "$GITHUB_OUTPUT"
  exit 0
fi

summary=$(printf '%s' "$json" | jq -r '.summary // ""')
if [ "${#summary}" -lt 10 ]; then
  echo "::warning::summary missing or < 10 chars; using placeholder."
  summary="(Claude did not emit a structured summary; inspect the diff on the branch.)"
fi

language=$(printf '%s' "$json" | jq -r '.language // ""')
case "$language" in
  zh|en|ja|ko|es|fr|de|ru|pt|other) ;;
  *)
    echo "::warning::language '$language' not in whitelist; coercing to '${fallback_lang}'."
    language="$fallback_lang"
    ;;
esac

{
  echo "summary<<SUMMARY_EOF"
  printf '%s\n' "$summary"
  echo "SUMMARY_EOF"
} >> "$GITHUB_OUTPUT"
echo "pr-language=${language}" >> "$GITHUB_OUTPUT"

echo "Parsed develop output: language=$language summary_len=${#summary}"
