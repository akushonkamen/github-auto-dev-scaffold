#!/usr/bin/env bash
# local-handle.sh — process a single issue with the local claude CLI.
#
# Called by poll.sh when a new `accepted`-labelled issue is detected.
# Steps:
#   1. Fetch issue body via gh
#   2. Create feature branch from $BASE_BRANCH (default: dev)
#   3. Invoke the local claude CLI in print (-p) mode with a tightly-scoped
#      prompt that points to the issue file
#   4. Push the branch and open a draft PR linked to the issue
#
# Safety knobs (set in ~/.config/githubautodev/config.sh):
#   CLAUDE_BIN           default: "claude"
#   BASE_BRANCH          default: "dev"
#   DRAFT_PR             default: "true"  (open as draft; flip to "false" for ready)
#   MAX_TURN_MINUTES     default: "15"    (timeout for the claude call)
#   DRY_RUN              default: "false" (if true: skip push + PR open)
#
# The script does NOT try to second-guess claude's output. If claude exits 0,
# we trust that something was committed and try to push + open PR. If claude
# exits non-zero, poll.sh will mark the issue as failed.
set -euo pipefail

# --- config ---------------------------------------------------------------

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"

USER_CONFIG="${GITHUBAUTODEV_CONFIG:-$HOME/.config/githubautodev/config.sh}"
if [ -f "$USER_CONFIG" ]; then
  # shellcheck disable=SC1090
  . "$USER_CONFIG"
fi

GITHUB_REPO="${GITHUB_REPO:?GITHUB_REPO must be set}"
GITHUB_TOKEN="${GITHUB_TOKEN:?GITHUB_TOKEN must be set}"

CLAUDE_BIN="${CLAUDE_BIN:-claude}"
BASE_BRANCH="${BASE_BRANCH:-dev}"
DRAFT_PR="${DRAFT_PR:-true}"
MAX_TURN_MINUTES="${MAX_TURN_MINUTES:-15}"
DRY_RUN="${DRY_RUN:-false}"

if [ "$#" -lt 1 ]; then
  echo "usage: $0 <issue-number>" >&2
  exit 2
fi

ISSUE_NUMBER="$1"
BRANCH_NAME="feat/issue-$ISSUE_NUMBER"

# --- helpers --------------------------------------------------------------

log() {
  local ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "[$ts] [handle] $*" >&2
}

# Switch to project root for all git operations.
cd "$PROJECT_ROOT"

# Make sure we're on $BASE_BRANCH and up to date. Fail loud if there are
# uncommitted changes — the user's working tree is sacred.
if ! git diff --quiet || ! git diff --cached --quiet; then
  log "ERROR: uncommitted changes in $PROJECT_ROOT; refusing to operate"
  exit 3
fi

log "fetching latest from origin"
git fetch origin "$BASE_BRANCH" --quiet

# Branch already exists? Likely a re-run. Switch to it; we'll layer on top.
if git show-ref --verify --quiet "refs/heads/$BRANCH_NAME"; then
  log "branch $BRANCH_NAME already exists; checking out"
  git checkout "$BRANCH_NAME" --quiet
else
  log "creating branch $BRANCH_NAME from origin/$BASE_BRANCH"
  git checkout -b "$BRANCH_NAME" "origin/$BASE_BRANCH" --quiet
fi

# --- fetch issue body -----------------------------------------------------

ISSUE_JSON="$(gh issue view "$ISSUE_NUMBER" --repo "$GITHUB_REPO" --json title,body,labels,url)"
ISSUE_TITLE="$(printf '%s' "$ISSUE_JSON" | jq -r '.title')"
ISSUE_URL="$(printf '%s' "$ISSUE_JSON" | jq -r '.url')"
ISSUE_BODY="$(printf '%s' "$ISSUE_JSON" | jq -r '.body // ""')"

if [ -z "$ISSUE_BODY" ]; then
  log "WARNING: issue #$ISSUE_NUMBER has empty body; proceeding with title only"
fi

ISSUE_FILE=""

# --- invoke local claude CLI ----------------------------------------------

# Issue body is embedded directly in the prompt. claude in -p mode runs with
# a sandbox that blocks reads outside the project root, so writing the body
# to a mktemp file outside the repo is unreadable.
read -r -d '' PROMPT <<EOF || true
You are working on issue #$ISSUE_NUMBER of $GITHUB_REPO.

Title: $ISSUE_TITLE
URL: $ISSUE_URL

Issue body:
\`\`\`
$ISSUE_BODY
\`\`\`

Workflow:
1. Read CLAUDE.md at the repo root for project context.
2. Read ONLY the directories the issue references — do not scan the whole repo.
3. Implement the change. Keep commits small.
4. Commit on the current branch ($BRANCH_NAME). Use a clear commit message
   that references "Closes #$ISSUE_NUMBER".
5. Do NOT push — the wrapper script will push and open the PR.

Hard rules:
- Never print tokens, API keys, or environment variable values (PRD §7 S4).
- Never commit to $BASE_BRANCH, main, or master. Only $BRANCH_NAME (PRD §7 S3).
- Do not force-push.
- If the issue is unclear or missing context, commit a single note explaining
  what is missing and exit non-zero so the wrapper marks the issue as failed.
EOF

log "invoking $CLAUDE_BIN (timeout ${MAX_TURN_MINUTES}m)"

# Use timeout(1) to prevent runaway. CLAUDE_BIN may be an absolute path or
# something on PATH. If it doesn't exist, fail fast.
if ! command -v "$CLAUDE_BIN" >/dev/null 2>&1; then
  log "ERROR: claude binary not found: $CLAUDE_BIN (set CLAUDE_BIN in $USER_CONFIG)"
  exit 4
fi

# macOS ships no `timeout`; brew's coreutils provides `gtimeout`. Pick
# whichever is available; fall back to no timeout with a warning.
TIMEOUT_BIN=""
if command -v timeout  >/dev/null 2>&1; then TIMEOUT_BIN="timeout";
elif command -v gtimeout >/dev/null 2>&1; then TIMEOUT_BIN="gtimeout"; fi

# -p = print mode (non-interactive). Output is captured for the action log.
# --permission-mode acceptEdits: auto-accept file edits inside the project
#   so claude can actually implement without interactive approval prompts
#   (which never arrive in -p mode and cause claude to bail with no commits).
#   This is the S5-compliant alternative to --dangerously-skip-permissions.
# --allowedTools: explicit allow-list. Block Bash(git push *) so claude
#   cannot bypass the wrapper's push+PR flow (PRD §7 S3 — wrapper owns push).
set +e
if [ -n "$TIMEOUT_BIN" ]; then
  "$TIMEOUT_BIN" "${MAX_TURN_MINUTES}m" "$CLAUDE_BIN" \
    --permission-mode acceptEdits \
    --allowedTools "Read Write Edit Grep Glob Bash" \
    --disallowedTools 'Bash(git push *)' \
    -p "$PROMPT"
  rc=$?
else
  log "WARNING: neither timeout nor gtimeout found; running without wall-clock cap"
  "$CLAUDE_BIN" \
    --permission-mode acceptEdits \
    --allowedTools "Read Write Edit Grep Glob Bash" \
    --disallowedTools 'Bash(git push *)' \
    -p "$PROMPT"
  rc=$?
fi
set -e
if [ "$rc" -ne 0 ]; then
  log "ERROR: $CLAUDE_BIN exited $rc"
  exit 5
fi

log "claude returned successfully"

# --- push + open PR -------------------------------------------------------

if [ "$DRY_RUN" = "true" ]; then
  log "DRY_RUN=true: skipping push + PR open"
  exit 0
fi

# Has claude actually produced any commits?
if [ "$(git rev-list --count "origin/$BASE_BRANCH..HEAD")" -eq 0 ]; then
  log "ERROR: claude exited 0 but produced no commits on $BRANCH_NAME"
  exit 6
fi

log "pushing $BRANCH_NAME"
git push -u origin "$BRANCH_NAME" --quiet

read -r -d '' PR_BODY <<EOF || true
Closes #$ISSUE_NUMBER

Generated by local claude code via \`scripts/local/handle.sh\`.

Issue: $ISSUE_URL
Branch: \`$BRANCH_NAME\`

Reviewers: please verify the change matches the issue intent. The cloud-side
triage workflow recommended acceptance; this PR is the implementation.
EOF

PR_FLAG=""
if [ "$DRAFT_PR" = "true" ]; then
  PR_FLAG="--draft"
fi

log "opening PR"
PR_URL="$(gh pr create \
  --repo "$GITHUB_REPO" \
  --base "$BASE_BRANCH" \
  --head "$BRANCH_NAME" \
  --title "feat(#$ISSUE_NUMBER): $(printf '%s' "$ISSUE_TITLE" | head -c 60)" \
  --body "$PR_BODY" \
  $PR_FLAG)"

log "PR opened: $PR_URL"
echo "$PR_URL"
