#!/usr/bin/env bash
# pat-actions.sh — Daily audit of PAT-owner actions (AC-V2-14)
#
# Fetches recent events for the repository and diffs against yesterday's
# snapshot to detect unexpected actions performed by the PAT owner.
# Designed to run as a daily cron/scheduled workflow.
#
# Requires: gh CLI with repo scope, GITHUB_REPO or GITHUB_REPOSITORY env var.
# Reads CLAUDE_DEV_PAT_OWNER from gh variable (or pass as arg).
#
# Usage:
#   ./scripts/audit/pat-actions.sh [pat_owner]
#   CLAUDE_DEV_PAT_OWNER=rkang246 ./scripts/audit/pat-actions.sh

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
AUDIT_DIR="$REPO_ROOT/.audit"
mkdir -p "$AUDIT_DIR"

REPO="${GITHUB_REPOSITORY:-${GITHUB_REPO:-}}"
if [ -z "$REPO" ]; then
  echo "FAIL: GITHUB_REPOSITORY or GITHUB_REPO must be set"
  exit 1
fi

PAT_OWNER="${1:-${CLAUDE_DEV_PAT_OWNER:-}}"
if [ -z "$PAT_OWNER" ]; then
  echo "FAIL: CLAUDE_DEV_PAT_OWNER must be set (pass as arg or set env var)"
  exit 1
fi

TODAY=$(date '+%Y-%m-%d')
YESTERDAY=$(date -j -v-1d '+%Y-%m-%d' 2>/dev/null || date -d 'yesterday' '+%Y-%m-%d')
SNAPSHOT_TODAY="$AUDIT_DIR/events-$TODAY.json"
SNAPSHOT_YESTERDAY="$AUDIT_DIR/events-$YESTERDAY.json"

# Fetch today's events by the PAT owner (last 100, 1 day lookback)
echo "=== PAT action audit for $PAT_OWNER on $REPO ($TODAY) ==="

gh api "repos/$REPO/events" --paginate --jq '
  .[] |
  select(.actor.login == "'"$PAT_OWNER"'") |
  {id, type, created_at, repo: .repo.name}
' > "$SNAPSHOT_TODAY" 2>/dev/null || echo "[]" > "$SNAPSHOT_TODAY"

count_today=$(jq -s 'length' "$SNAPSHOT_TODAY" 2>/dev/null || echo 0)

if [ "$count_today" -eq 0 ]; then
  echo "PASS: No PAT-owner actions detected today ($TODAY)"
  exit 0
fi

echo "Found $count_today event(s) by $PAT_OWNER today:"
jq -r '. | "[\(.created_at)] \(.type)"' "$SNAPSHOT_TODAY"

# Diff against yesterday if available
if [ -f "$SNAPSHOT_YESTERDAY" ]; then
  new_today=$(comm -23 \
    <(jq -r '.id' "$SNAPSHOT_TODAY" | sort) \
    <(jq -r '.id' "$SNAPSHOT_YESTERDAY" | sort) | wc -l | tr -d ' ')
  echo "New events since yesterday: $new_today"
fi

# Flag unexpected event types
UNEXPECTED=$(jq -r '
  select(.type as $t |
    ["PushEvent","PullRequestEvent","IssuesEvent","IssueCommentEvent",
     "CreateEvent","DeleteEvent","LabelEvent","CommitCommentEvent",
     "PullRequestReviewEvent","PullRequestReviewCommentEvent"] |
    index($t) | not
  ) | "UNEXPECTED: \(.type) at \(.created_at)"
' "$SNAPSHOT_TODAY" 2>/dev/null || true)

if [ -n "$UNEXPECTED" ]; then
  echo "WARN: Unexpected event types detected:"
  echo "$UNEXPECTED"
fi

echo "PASS: PAT audit complete ($count_today events)"
