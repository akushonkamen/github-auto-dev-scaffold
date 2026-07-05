#!/usr/bin/env bash
# local-poll.sh — the "consumer" side of the hybrid architecture.
#
# Cloud side (already implemented): issue → workflow → analyse → comment →
#   apply `accepted` label.
#
# This script (local side): poll GitHub for issues labelled `accepted` that we
# have not yet handled; for each new one, invoke scripts/local/handle.sh,
# which calls the local claude CLI.
#
# Cron-friendly: stateless across invocations (uses an on-disk seen-file),
# uses flock to prevent concurrent runs, swallows non-fatal errors.
#
# Recommended cron entry (every 2 minutes):
#   */2 * * * * /path/to/scripts/local/poll.sh >> /tmp/githubautodev-poll.log 2>&1
#
# Required env (set in ~/.config/githubautodev/config.sh or export in crontab):
#   GITHUB_REPO          e.g. "akushonkamen/github-auto-dev-scaffold"
#   GITHUB_TOKEN         a PAT with `repo` scope (or `gh auth token` output)
#
# Optional env:
#   STATE_DIR            default: ${XDG_STATE_HOME:-$HOME/.local/state}/githubautodev
#   TRIGGER_LABEL        default: "accepted"  (the cloud-side handoff signal)
#   HANDLE_SCRIPT        default: <script dir>/handle.sh
#   POLL_LOG_LEVEL       default: "info"  (debug|info|warn|error)
set -euo pipefail

# --- config ---------------------------------------------------------------

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"

# Load user config if present (this is how users override defaults without
# editing this file).
USER_CONFIG="${GITHUBAUTODEV_CONFIG:-$HOME/.config/githubautodev/config.sh}"
if [ -f "$USER_CONFIG" ]; then
  # shellcheck disable=SC1090
  . "$USER_CONFIG"
fi

GITHUB_REPO="${GITHUB_REPO:?GITHUB_REPO must be set (e.g. owner/name)}"
GITHUB_TOKEN="${GITHUB_TOKEN:?GITHUB_TOKEN must be set}"

STATE_DIR="${STATE_DIR:-$HOME/.local/state/githubautodev}"
TRIGGER_LABEL="${TRIGGER_LABEL:-accepted}"
HANDLE_SCRIPT="${HANDLE_SCRIPT:-$SCRIPT_DIR/handle.sh}"
POLL_LOG_LEVEL="${POLL_LOG_LEVEL:-info}"

mkdir -p "$STATE_DIR"
SEEN_FILE="$STATE_DIR/seen.txt"
FAILED_FILE="$STATE_DIR/failed.txt"

# --- logging --------------------------------------------------------------

log() {
  local level="$1"; shift
  local msg="$*"
  local ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "[$ts] [$level] $msg"
}

case "$POLL_LOG_LEVEL" in
  debug) declare -i LOG_DEBUG=1 ;;
  *)     declare -i LOG_DEBUG=0 ;;
esac

# --- single-flight --------------------------------------------------------
# mkdir is atomic on POSIX filesystems, so it makes a portable lock that
# works on macOS (no flock) and Linux alike. We hold the lock for the
# lifetime of the process via the open fd; the dir is removed on exit.

LOCK_DIR="$STATE_DIR/poll.lock.d"
cleanup_lock() { rmdir "$LOCK_DIR" 2>/dev/null || true; }
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  log warn "another poll is running; skipping"
  exit 0
fi
trap cleanup_lock EXIT INT TERM

# --- core -----------------------------------------------------------------

touch "$SEEN_FILE" "$FAILED_FILE"

# Fetch open issues with the trigger label.
# `--search` lets us scope to open issues only and avoid pulling closed ones.
log info "polling $GITHUB_REPO for issues labelled '$TRIGGER_LABEL'"
issues_json="$(gh issue list \
  --repo "$GITHUB_REPO" \
  --label "$TRIGGER_LABEL" \
  --state open \
  --json number,title \
  --limit 50 2>/dev/null || echo '[]')"

# Extract issue numbers (one per line).
new_numbers="$(printf '%s' "$issues_json" | jq -r '.[].number' 2>/dev/null || true)"

if [ -z "$new_numbers" ]; then
  [ "$LOG_DEBUG" = 1 ] && log debug "no issues labelled '$TRIGGER_LABEL' found"
  exit 0
fi

handled_count=0
skipped_count=0
failed_count=0

while IFS= read -r num; do
  [ -z "$num" ] && continue

  # Skip if we've already handled (or attempted) this one.
  if grep -qx "$num" "$SEEN_FILE"; then
    skipped_count=$((skipped_count + 1))
    continue
  fi
  if grep -qx "$num" "$FAILED_FILE"; then
    skipped_count=$((skipped_count + 1))
    continue
  fi

  log info "issue #$num: dispatching to handle.sh"
  if "$HANDLE_SCRIPT" "$num"; then
    echo "$num" >> "$SEEN_FILE"
    handled_count=$((handled_count + 1))
    log info "issue #$num: handled"
  else
    rc=$?
    echo "$num" >> "$FAILED_FILE"
    failed_count=$((failed_count + 1))
    log error "issue #$num: handle.sh exited $rc; marked failed (remove from $FAILED_FILE to retry)"
  fi
done <<< "$new_numbers"

log info "poll done: $handled_count handled, $skipped_count skipped, $failed_count failed"
