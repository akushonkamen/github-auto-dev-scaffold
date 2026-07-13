#!/usr/bin/env bash
# Parse LLM engine output for the triage composite action.
#
# PR #132: GLM passthrough does not reliably honor --json-schema strict
# mode. Claude now posts its decision as an issue comment containing a
# hidden <!-- TRIAGE_VERDICT {...} --> JSON block. This script tolerates:
#   (a) pure JSON
#   (b) prose + JSON mixed
#   (c) ```json``` fenced JSON
#   (d) hidden HTML-comment-wrapped JSON (TRIAGE_VERDICT block)
# If all extraction strategies fail, we fall back to decision="reply" with
# the raw output as comment_body — this lets clarify-loop take over
# gracefully instead of hard-failing the triage workflow.
#
# Input env var:
#   STRUCTURED — claude-code-action `structured_output` OR the latest issue
#                comment body containing the TRIAGE_VERDICT block.
#
# Writes to GITHUB_OUTPUT:
#   decision         — "reply" | "work"
#   comment_body     — multi-line markdown (heredoc EOF delimiter)
#   suggested_labels — comma-separated string (empty if none)
#   confidence       — float in [0,1]
#   workload_class   — "trivial" | "standard" | "complex"
set -euo pipefail

raw="${STRUCTURED:-}"

if [ -z "$raw" ]; then
  echo "::error::STRUCTURED env is empty."
  echo "::error::Verify that Claude posted its TRIAGE_VERDICT comment."
  exit 1
fi

# --- extraction strategies (try each in order) -------------------------------
extract_json() {
  local input="$1"
  # Strategy 1: hidden TRIAGE_VERDICT block
  local block
  block=$(printf '%s' "$input" \
    | sed -n '/<!-- TRIAGE_VERDICT/,/-->/p' \
    | sed -e '1d;$d' \
    | tr -d '\n' \
    | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
  if [ -n "$block" ] && printf '%s' "$block" | jq -e . >/dev/null 2>&1; then
    printf '%s' "$block"
    return 0
  fi
  # Strategy 2: ```json ... ``` fenced block (last match wins)
  block=$(printf '%s' "$input" \
    | awk '/```json/{flag=1;next}/```/{flag=0}flag' \
    | tr -d '\n' \
    | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
  if [ -n "$block" ] && printf '%s' "$block" | jq -e . >/dev/null 2>&1; then
    printf '%s' "$block"
    return 0
  fi
  # Strategy 3: first `{` ... last `}` substring
  block=$(printf '%s' "$input" \
    | sed -n 's/.*\({.*}\).*/\1/p' \
    | tr -d '\n' \
    | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
  if [ -n "$block" ] && printf '%s' "$block" | jq -e . >/dev/null 2>&1; then
    printf '%s' "$block"
    return 0
  fi
  # Strategy 4: input is already pure JSON
  if printf '%s' "$input" | jq -e . >/dev/null 2>&1; then
    printf '%s' "$input" | tr -d '\n'
    return 0
  fi
  return 1
}

json=$(extract_json "$raw") || json=""

if [ -z "$json" ]; then
  echo "::warning::All JSON extraction strategies failed. Falling back to decision=reply."
  echo "::warning::Clarify-loop will take over to gather more info from the issue author."
  echo "Raw output (first 500 chars):"
  printf '%s' "$raw" | head -c 500 | sed 's/^/  raw> /'
  echo ""
  # Fallback: safe defaults — let clarify-loop triage it manually.
  echo "decision=reply"                 >> "$GITHUB_OUTPUT"
  echo "confidence=0.3"                 >> "$GITHUB_OUTPUT"
  echo "suggested_labels="              >> "$GITHUB_OUTPUT"
  echo "workload_class=complex"         >> "$GITHUB_OUTPUT"
  {
    echo "comment_body<<COMMENT_BODY_EOF"
    echo "I couldn't parse the triage decision automatically. Could you provide more detail on:"
    echo ""
    echo "- The expected behavior"
    echo "- Any relevant acceptance criteria"
    echo "- Affected files or modules"
    echo ""
    echo "(Triage parse fallback — raw LLM output is in the workflow logs.)"
    echo "COMMENT_BODY_EOF"
  } >> "$GITHUB_OUTPUT"
  echo "Parsed triage output (fallback): decision=reply workload_class=complex"
  exit 0
fi

# Validate the extracted JSON has the required shape. Coerce missing/invalid
# fields to safe defaults rather than failing — the goal is non-blocking.
decision=$(printf '%s' "$json" | jq -r '.decision // "reply"')
case "$decision" in
  reply|work) ;;
  *)
    echo "::warning::decision has unexpected value '$decision'; coercing to 'reply'"
    decision="reply"
    ;;
esac

comment_body=$(printf '%s' "$json" | jq -r '.comment_body // ""')
if [ "${#comment_body}" -lt 10 ]; then
  echo "::warning::comment_body is empty or < 10 chars; using placeholder."
  comment_body="(Triage could not extract a clear comment_body. Please clarify the issue.)"
fi

suggested_labels=$(printf '%s' "$json" | jq -r '.suggested_labels | if type == "array" then (if length == 0 then "" else map(tostring) | join(",") end) else "" end')

confidence=$(printf '%s' "$json" | jq -r '.confidence // 0.5')
case "$confidence" in
  ''|*[!0-9.]*) confidence=0.5 ;;
esac
# Clamp to [0,1]
awk -v c="$confidence" 'BEGIN { if (c+0 < 0) c=0; if (c+0 > 1) c=1; printf "%.3f", c+0 }' \
  > /tmp/_conf.$$ && confidence=$(cat /tmp/_conf.$$) && rm -f /tmp/_conf.$$

workload_class=$(printf '%s' "$json" | jq -r '.workload_class // "standard"')
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

{
  echo "comment_body<<COMMENT_BODY_EOF"
  printf '%s\n' "$comment_body"
  echo "COMMENT_BODY_EOF"
} >> "$GITHUB_OUTPUT"

echo "Parsed triage output: decision=$decision confidence=$confidence labels=[$suggested_labels] workload_class=$workload_class"
