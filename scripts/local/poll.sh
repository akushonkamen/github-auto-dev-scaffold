#!/usr/bin/env bash
# local-poll.sh — the "consumer" side of the hybrid architecture.
#
# Cloud side (already implemented): issue → workflow → analyse → comment →
#   apply `accepted` label OR `needs-ralph` label.
#
# This script (local side): poll GitHub for issues labelled `accepted` or
# `needs-ralph` that we have not yet handled; for each new one, invoke the
# appropriate handler script:
#   - `accepted`      → handle.sh       (Module 4 develop path)
#   - `needs-ralph`   → handle-triage.sh (deep analysis path)
#
# AC-P4 race priority: if an issue has BOTH labels (maintainer raced ralph),
# `accepted` wins. Dispatch to handle.sh; mark issue seen so handle-triage.sh
# does NOT subsequently run on it.
#
# Cron-friendly: stateless across invocations (uses on-disk seen-file),
# uses mkdir as a portable lock (no flock dependency, works on macOS + Linux),
# swallows non-fatal errors.
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
#   TRIGGER_LABEL        default: "accepted"     (develop path trigger)
#   TRIAGE_LABEL         default: "needs-ralph"  (deep-analysis path trigger)
#   HANDLE_SCRIPT        default: <script dir>/handle.sh
#   TRIAGE_HANDLE_SCRIPT default: <script dir>/handle-triage.sh
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

# v2 coexistence (AC-V2-12b): local v1 poller is OPT-IN. Default POLL_ENABLED=false
# means this script exits immediately without polling. The v2 cloud pipeline
# (clarify-loop.yml + develop.yml) handles the full Issue → Triage → Clarify →
# Develop loop end-to-end. Set POLL_ENABLED=true in ~/.config/githubautodev/config.sh
# to enable the v1 fallback (e.g. for `decision==reply` issues needing local re-analysis).
POLL_ENABLED="${POLL_ENABLED:-false}"
if [ "$POLL_ENABLED" != "true" ]; then
  echo "[poll] POLL_ENABLED=false (v2 cloud pipeline is authoritative); exiting" >&2
  exit 0
fi

STATE_DIR="${STATE_DIR:-$HOME/.local/state/githubautodev}"
TRIGGER_LABEL="${TRIGGER_LABEL:-accepted}"
TRIAGE_LABEL="${TRIAGE_LABEL:-needs-ralph}"
HANDLE_SCRIPT="${HANDLE_SCRIPT:-$SCRIPT_DIR/handle.sh}"
TRIAGE_HANDLE_SCRIPT="${TRIAGE_HANDLE_SCRIPT:-$SCRIPT_DIR/handle-triage.sh}"
POLL_LOG_LEVEL="${POLL_LOG_LEVEL:-info}"

mkdir -p "$STATE_DIR"
SEEN_FILE="$STATE_DIR/seen.txt"
FAILED_FILE="$STATE_DIR/failed.txt"
TRIAGE_FAILED_FILE="$STATE_DIR/triage-failed.txt"

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

touch "$SEEN_FILE" "$FAILED_FILE" "$TRIAGE_FAILED_FILE"

# AC-P1: fetch via TWO separate gh issue list calls (GitHub --label a,b is AND).
# Merge results, dedupe by issue number, retain label-set for dispatch logic.
log info "polling $GITHUB_REPO for issues labelled '$TRIGGER_LABEL' or '$TRIAGE_LABEL'"

accepted_json="$(gh issue list \
  --repo "$GITHUB_REPO" \
  --label "$TRIGGER_LABEL" \
  --state open \
  --json number \
  --limit 50 2>/dev/null || echo '[]')"
ralph_json="$(gh issue list \
  --repo "$GITHUB_REPO" \
  --label "$TRIAGE_LABEL" \
  --state open \
  --json number \
  --limit 50 2>/dev/null || echo '[]')"

# Union of issue numbers, deduped. Per-issue label resolution happens in the
# dispatch check below via the in_accepted / in_ralph helpers.
union_numbers="$(printf '%s\n%s\n' "$accepted_json" "$ralph_json" \
  | jq -r '.[].number' 2>/dev/null \
  | sort -n \
  | uniq)"

if [ -z "$union_numbers" ]; then
  [ "$LOG_DEBUG" = 1 ] && log debug "no issues labelled '$TRIGGER_LABEL' or '$TRIAGE_LABEL' found"
  exit 0
fi

# Helper: is issue N in the accepted list?
in_accepted() {
  local n="$1"
  printf '%s' "$accepted_json" | jq -e --argjson n "$n" '.[] | select(.number==$n)' >/dev/null 2>&1
}
# Helper: is issue N in the needs-ralph list?
in_ralph() {
  local n="$1"
  printf '%s' "$ralph_json" | jq -e --argjson n "$n" '.[] | select(.number==$n)' >/dev/null 2>&1
}

handled_count=0
skipped_count=0
failed_count=0

while IFS= read -r num; do
  [ -z "$num" ] && continue

  # Skip if we've already handled (or attempted) this one in EITHER path.
  if grep -qx "$num" "$SEEN_FILE"; then
    skipped_count=$((skipped_count + 1))
    continue
  fi
  if grep -qx "$num" "$FAILED_FILE"; then
    skipped_count=$((skipped_count + 1))
    continue
  fi
  if grep -qx "$num" "$TRIAGE_FAILED_FILE"; then
    skipped_count=$((skipped_count + 1))
    continue
  fi

  # AC-P4 race priority: if both labels present, accepted wins. Dispatch to
  # handle.sh; mark seen so handle-triage.sh does NOT pick it up later.
  has_accepted="no"; has_ralph="no"
  if in_accepted "$num"; then has_accepted="yes"; fi
  if in_ralph "$num"; then has_ralph="yes"; fi

  if [ "$has_accepted" = "yes" ] && [ "$has_ralph" = "yes" ]; then
    log info "issue #$num: has both $TRIGGER_LABEL + $TRIAGE_LABEL; $TRIGGER_LABEL wins (AC-P4)"
    # Best-effort: remove needs-ralph so future polls don't keep considering it.
    # If the GH call fails (permissions, etc.), we still dispatch to handle.sh;
    # marking seen prevents double-handling.
    gh issue edit "$num" --repo "$GITHUB_REPO" --remove-label "$TRIAGE_LABEL" 2>/dev/null || true
    if "$HANDLE_SCRIPT" "$num"; then
      echo "$num" >> "$SEEN_FILE"
      handled_count=$((handled_count + 1))
      log info "issue #$num: handled (accepted path)"
    else
      rc=$?
      echo "$num" >> "$FAILED_FILE"
      failed_count=$((failed_count + 1))
      log error "issue #$num: handle.sh exited $rc; marked failed"
    fi
    continue
  fi

  if [ "$has_accepted" = "yes" ]; then
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
    continue
  fi

  if [ "$has_ralph" = "yes" ]; then
    log info "issue #$num: dispatching to handle-triage.sh"
    if "$TRIAGE_HANDLE_SCRIPT" "$num"; then
      echo "$num" >> "$SEEN_FILE"
      handled_count=$((handled_count + 1))
      log info "issue #$num: handled (triage path)"
    else
      rc=$?
      echo "$num" >> "$TRIAGE_FAILED_FILE"
      failed_count=$((failed_count + 1))
      log error "issue #$num: handle-triage.sh exited $rc; marked failed (remove from $TRIAGE_FAILED_FILE to retry)"
    fi
    continue
  fi

  # Shouldn't reach here (number came from one of the lists), but guard anyway.
  [ "$LOG_DEBUG" = 1 ] && log debug "issue #$num: no dispatch label found; skipping"
done <<< "$union_numbers"

log info "poll done: $handled_count handled, $skipped_count skipped, $failed_count failed"
