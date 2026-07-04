#!/usr/bin/env bash
# apply.sh — Apply the judge verdict according to mode.
#
# Modes (PRD §3):
#   auto    → apply decision label directly
#   manual  → post suggestion comment ONLY (no label change)
#   hybrid  → if confidence >= threshold, auto-apply; else fall through to manual
#
# Idempotency: the audit comment is matched by a hidden HTML marker and edited
# in place on re-runs (PRD §6). Never posts a duplicate audit comment.
#
# Always posts an audit comment (PRD §3 Audit invariant).
# Reads from env (set by caller workflow):
#   MODE, NUMBER, DECISION, CONFIDENCE, THRESHOLD_INPUT, REASON, GH_TOKEN
set -euo pipefail

: "${MODE:?MODE env required}"
: "${NUMBER:?NUMBER env required}"
: "${DECISION:?DECISION env required}"
: "${CONFIDENCE:?CONFIDENCE env required}"
: "${REASON:?REASON env required}"

# Default threshold per PRD §8 item 5 (待试运行标定; starting value 0.7).
THRESHOLD="${THRESHOLD_INPUT:-0.7}"

# Decide whether to auto-apply.
apply=false
case "$MODE" in
  auto)
    apply=true
    ;;
  manual)
    apply=false
    ;;
  hybrid)
    # Numeric compare via awk for float safety
    if awk -v c="$CONFIDENCE" -v t="$THRESHOLD" 'BEGIN { exit !(c >= t) }'; then
      apply=true
    else
      apply=false
    fi
    ;;
  *)
    echo "::error::Unknown MODE='$MODE'"
    exit 1
    ;;
esac

# Compose audit comment. The HTML marker is used for idempotency (re-runs
# edit the prior audit comment in place).
MARKER="<!-- githubautodev:judge-audit -->"
if $apply; then
  APPLIED="(auto-applied by Module 3 in \`$MODE\` mode, confidence=$CONFIDENCE, threshold=$THRESHOLD)"
else
  APPLIED="(suggestion only — \`$MODE\` mode did not auto-apply, confidence=$CONFIDENCE, threshold=$THRESHOLD)"
fi

BODY=$(cat <<EOF
$MARKER
## Module 3 — Judgement audit
- **Decision:** \`${DECISION}\`
- **Mode:** \`${MODE}\`
- **Confidence:** \`${CONFIDENCE}\`
- **Threshold:** \`${THRESHOLD}\`
- **Action taken:** ${APPLIED}

### Reason
${REASON}
EOF
)

# Find prior audit comment by marker; edit in place if present, else create.
prior_id=$(gh issue view "$NUMBER" --json comments \
  --jq ".comments[] | select(.body | contains(\"$MARKER\")) | .id" \
  | head -n1)

if [ -n "$prior_id" ]; then
  # PATCH the existing comment via the REST API.
  payload=$(jq -n --arg b "$BODY" '{body: $b}')
  gh api -X PATCH \
    "repos/:owner/:repo/issues/comments/$prior_id" \
    --input - <<<"$payload" >/dev/null
  audit_url=$(gh api "repos/:owner/:repo/issues/comments/$prior_id" --jq '.html_url')
else
  url=$(gh issue comment "$NUMBER" --body "$BODY")
  audit_url="$url"
fi
echo "Audit comment: $audit_url"

# Optional: surface audit URL for the calling workflow.
echo "audit-url=$audit_url" >> "${GITHUB_OUTPUT:-/dev/null}"

if $apply; then
  # Translate decision → label and apply.
  case "$DECISION" in
    accepted)
      gh issue edit "$NUMBER" --add-label "accepted" --remove-label "triage-done"
      ;;
    rejected)
      gh issue edit "$NUMBER" --add-label "rejected" --remove-label "triage-done"
      ;;
    needs-info)
      gh issue edit "$NUMBER" --add-label "needs-info" --remove-label "triage-done"
      ;;
    *)
      echo "::error::Unknown DECISION='$DECISION'"
      exit 1
      ;;
  esac
  echo "Applied label for decision=$DECISION"
else
  echo "Manual mode — no label applied; audit comment posted only."
fi
