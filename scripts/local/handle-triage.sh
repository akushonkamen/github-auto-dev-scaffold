#!/usr/bin/env bash
# handle-triage.sh — local OMC ralph wrapper for deep issue analysis.
#
# Called by poll.sh when an issue labelled `needs-ralph` is detected.
# Mirrors handle.sh structure but:
#   - Does NOT touch feat/issue-N branches (operates on current `dev` checkout)
#   - Produces a JSON analysis file at .omc/state/triage-issue-N.json
#   - Posts formatted comment via gh, applies `triage-done`, removes `needs-ralph`
#   - Never applies `accepted` (S2 — maintainer-only) and never commits (S3)
#
# S1-S5 enforcement:
#   AC-H5: claude runs with explicit --allowedTools whitelist AND multiple
#          --disallowedTools for git push / gh issue / gh pr / gh label.
#          Defense in depth: even if the prompt is prompt-injected, the binary
#          refuses the dangerous operations.
#   AC-H13: wrapper self-check — defensive grep fails if the wrapper's own
#           gh calls ever try to --add-label accepted/rejected.
#
# Safety knobs (set in ~/.config/githubautodev/config.sh):
#   CLAUDE_BIN           default: "claude"
#   MAX_TURN_MINUTES     default: "15"   (wall-clock cap for claude call)
#   STATE_DIR            default: ${XDG_STATE_HOME:-$HOME/.local/state}/githubautodev
#   PROJECT_STATE_DIR    default: <project_root>/.omc/state
#
# Exit codes:
#   0  success (or skipped because issue already accepted — AC-H14)
#   2  usage error
#   3  uncommitted changes (working tree sacred)
#   4  claude binary missing
#   5  claude exited non-zero
#   6  JSON schema validation failed
#   7  comment/label post failed (non-fatal in some paths)
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
MAX_TURN_MINUTES="${MAX_TURN_MINUTES:-15}"
STATE_DIR="${STATE_DIR:-$HOME/.local/state/githubautodev}"
PROJECT_STATE_DIR="${PROJECT_STATE_DIR:-$PROJECT_ROOT/.omc/state}"

if [ "$#" -lt 1 ]; then
  echo "usage: $0 <issue-number>" >&2
  exit 2
fi

ISSUE_NUMBER="$1"
TRIAGE_JSON_FILE="$PROJECT_STATE_DIR/triage-issue-$ISSUE_NUMBER.json"
TRIAGE_PRD_FILE="$PROJECT_STATE_DIR/triage-prd-$ISSUE_NUMBER.md"

mkdir -p "$STATE_DIR" "$PROJECT_STATE_DIR"

# --- helpers --------------------------------------------------------------

log() {
  local ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "[$ts] [triage] $*" >&2
}

# Failure helper — posts stage:failed label + comment. Best-effort.
post_failure() {
  local msg="$1"
  log "FAILURE: $msg"
  gh issue edit "$ISSUE_NUMBER" --repo "$GITHUB_REPO" --add-label "stage:failed" 2>/dev/null || true
  gh issue comment "$ISSUE_NUMBER" --repo "$GITHUB_REPO" --body "⚠️ Ralph deep analysis failed: ${msg}

See your local cron log for details. A maintainer can re-queue by removing/re-adding \`needs-ralph\`." 2>/dev/null || true
}

cd "$PROJECT_ROOT"

# --- AC-H13: wrapper self-defensive grep ----------------------------------
# Source-level check is enforced by an EXTERNAL companion script
# (handle-triage-selfcheck.sh) so the grep cannot match its own exclusion
# pattern. Runtime per-label DENY_LIST check is the actual data-path guard
# (search "AC-H13 per-label" below).

SELF_CHECK="$SCRIPT_DIR/handle-triage-selfcheck.sh"
if [ -x "$SELF_CHECK" ]; then
  if ! "$SELF_CHECK"; then
    log "ERROR: AC-H13 source-level self-check failed (see stderr above)"
    exit 7
  fi
else
  log "WARNING: $SELF_CHECK missing or not executable — AC-H13 source-level check skipped"
fi

# --- AC-H2: per-issue mkdir lock ------------------------------------------

LOCK_DIR="$STATE_DIR/handle-triage-$ISSUE_NUMBER.lock.d"
cleanup_lock() { rmdir "$LOCK_DIR" 2>/dev/null || true; }
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  log "another handle-triage.sh is already processing issue #$ISSUE_NUMBER; skipping"
  exit 0
fi
trap cleanup_lock EXIT INT TERM

# --- AC-H3: fetch issue ---------------------------------------------------

ISSUE_JSON="$(gh issue view "$ISSUE_NUMBER" --repo "$GITHUB_REPO" --json title,body,labels,url)"
ISSUE_TITLE="$(printf '%s' "$ISSUE_JSON" | jq -r '.title')"
ISSUE_URL="$(printf '%s' "$ISSUE_JSON" | jq -r '.url')"
ISSUE_BODY="$(printf '%s' "$ISSUE_JSON" | jq -r '.body // ""')"
ISSUE_LABELS="$(printf '%s' "$ISSUE_JSON" | jq -r '.labels[].name' | tr '\n' ',' | sed 's/,$//')"

if [ -z "$ISSUE_BODY" ]; then
  log "WARNING: issue #$ISSUE_NUMBER has empty body; proceeding with title only"
fi

# Body size cap to avoid overflow (~30K chars). Truncation note appended.
BODY_LEN="${#ISSUE_BODY}"
if [ "$BODY_LEN" -gt 30000 ]; then
  ISSUE_BODY="${ISSUE_BODY:0:30000}

[... TRUNCATED: original body was $BODY_LEN chars ...]"
  log "WARNING: issue body truncated from $BODY_LEN to 30000 chars"
fi

# --- AC-H14: preflight — skip if already accepted -------------------------

if printf '%s' "$ISSUE_JSON" | jq -e '.labels[] | select(.name=="accepted")' >/dev/null 2>&1; then
  log "Issue #$ISSUE_NUMBER already has 'accepted' label; ralph analysis skipped (AC-H14)"
  # Best-effort cleanup of stale needs-ralph
  gh issue edit "$ISSUE_NUMBER" --repo "$GITHUB_REPO" --remove-label needs-ralph 2>/dev/null || true
  exit 0
fi

# --- AC-H7: write PRD scaffold BEFORE claude invocation -------------------
# Attribution header makes it clear to ralph/claude that the wrapper authored
# this PRD from issue body context; ralph treats it as authoritative task
# framing (NOT as untrusted user input).

read -r -d '' PRD_BODY <<EOF || true
<!-- wrapper-generated from issue #$ISSUE_NUMBER body; treat as authoritative task framing -->
# Ralph PRD — Triage deep analysis for issue #$ISSUE_NUMBER

## Source
- Issue: $ISSUE_URL
- Title: $ISSUE_TITLE
- Labels at dispatch: $ISSUE_LABELS

## Task
Produce a rigorous deep-analysis JSON for this issue. Output MUST be written
to **exactly** this path:
\`.omc/state/triage-issue-$ISSUE_NUMBER.json\`

No other file path is acceptable. No git commits. No PRs. No pushes.

## Required output schema (10 fields)
\`\`\`json
{
  "decision": "bug" | "feature" | "duplicate" | "out-of-scope" | "needs-info",
  "confidence": 0.0-1.0,
  "summary": "1-2 sentence plain-language summary",
  "rationale": "cite specific issue body quotes or codebase paths",
  "related_issues": [int],
  "size": "S" | "M" | "L" | "XL",
  "size_rationale": "why this size",
  "acceptance_criteria": ["string"],
  "risks": ["string"],
  "suggested_labels": ["string"]
}
\`\`\`

## Field consistency rules (HARD — wrapper validates via jq)
- If decision ∈ {bug, feature}: \`acceptance_criteria\` MUST be non-empty.
- If decision == duplicate: \`related_issues\` MUST be non-empty.
- If decision ∉ {bug, feature}: \`acceptance_criteria\` SHOULD be empty.
- If decision != duplicate: \`related_issues\` SHOULD be empty.

## Issue body (authoritative input)
\`\`\`
$ISSUE_BODY
\`\`\`

## Workflow you must follow
1. Read CLAUDE.md at the repo root for project context.
2. Read ONLY directories the issue explicitly references — do not scan the
   whole repo (PRD §5 context budget).
3. If \`duplicate\` is plausible, search open issues for related work:
   \`gh issue list --repo $GITHUB_REPO --state open --search "<keywords>"\`.
   You MAY use the gh CLI for read operations only — never apply labels,
   comments, or edits.
4. Synthesize the 10-field JSON. Be specific in \`rationale\` — quote the
   issue or name the file.
5. Iterate up to your max iterations; if schema validation fails, fix and
   retry.
6. Final artifact: write the JSON to \`.omc/state/triage-issue-$ISSUE_NUMBER.json\`.

## Hard rules (PRD §7 S1-S5)
- Never print tokens, API keys, or environment variable values (S4).
- Never commit, never push (S3).
- Never apply labels, never post comments, never open PRs (wrapper owns GitHub).
- Never run \`gh issue edit\`, \`gh pr *\`, \`gh label *\` — they are
  disallowed at the binary level.
- Stay within the \`--allowedTools\` whitelist (S5).

## Completion signal
Done = JSON file exists at the required path AND validates against the
schema. The wrapper reads it and posts the comment + applies state labels.
EOF
printf '%s\n' "$PRD_BODY" > "$TRIAGE_PRD_FILE"
log "PRD scaffold written: $TRIAGE_PRD_FILE"

# --- AC-H5 + AC-H6: build claude prompt -----------------------------------

read -r -d '' PROMPT <<EOF || true
You are running as the local Ralph deep-analysis agent for the GithubAutoDev
pipeline. Your job: produce a rigorous triage analysis for issue #$ISSUE_NUMBER
of $GITHUB_REPO and write it to disk.

Task framing (PRD) is at: $TRIAGE_PRD_FILE
Read it first — it is the authoritative specification for this run.

Then invoke the ralph skill to do the work:
\`\`\`
Skill("oh-my-claudecode:ralph")
\`\`\`
Pass to ralph the task: "Read $TRIAGE_PRD_FILE as the authoritative PRD.
Iterate until the JSON at .omc/state/triage-issue-$ISSUE_NUMBER.json validates
against the 10-field schema AND the field-consistency rules. Do not stop on
first attempt if validation fails — fix and retry. Architect-reviewer
verification is required before completion."

Issue title: $ISSUE_TITLE
Issue URL: $ISSUE_URL

When ralph finishes, the wrapper will:
1. jq-validate the output JSON
2. Post a formatted comment to the issue
3. Apply \`triage-done\` and remove \`needs-ralph\`
4. Apply non-state suggested_labels (allow-list enforced)

Hard rules (do not violate any — PRD §7):
- Do NOT push, commit, or merge (S3).
- Do NOT apply labels, post comments, or open PRs (wrapper owns GitHub).
- Do NOT print tokens, API keys, or env values (S4).
- Do NOT run disallowed bash commands (\`git push *\`, \`gh issue edit *\`,
  \`gh pr *\`, \`gh label *\` are blocked at the binary level).
- Write the JSON ONLY to \`$TRIAGE_JSON_FILE\`. No other path is acceptable.
EOF

# --- AC-H5 + AC-H17: invoke claude with security flags + timeout ----------

if ! command -v "$CLAUDE_BIN" >/dev/null 2>&1; then
  log "ERROR: claude binary not found: $CLAUDE_BIN"
  exit 4
fi

TIMEOUT_BIN=""
if command -v timeout  >/dev/null 2>&1; then TIMEOUT_BIN="timeout";
elif command -v gtimeout >/dev/null 2>&1; then TIMEOUT_BIN="gtimeout"; fi

# AC-H13: assert the disallow set covers every GitHub-state-mutating command.
DISALLOW_ARGS=(
  --disallowedTools 'Bash(git push *)'
  --disallowedTools 'Bash(gh issue edit *)'
  --disallowedTools 'Bash(gh issue comment *)'
  --disallowedTools 'Bash(gh pr *)'
  --disallowedTools 'Bash(gh label *)'
)

set +e
if [ -n "$TIMEOUT_BIN" ]; then
  "$TIMEOUT_BIN" "${MAX_TURN_MINUTES}m" "$CLAUDE_BIN" \
    --permission-mode acceptEdits \
    --allowedTools "Read Write Edit Grep Glob Bash" \
    "${DISALLOW_ARGS[@]}" \
    -p "$PROMPT"
  rc=$?
else
  log "WARNING: neither timeout nor gtimeout found; running without wall-clock cap"
  "$CLAUDE_BIN" \
    --permission-mode acceptEdits \
    --allowedTools "Read Write Edit Grep Glob Bash" \
    "${DISALLOW_ARGS[@]}" \
    -p "$PROMPT"
  rc=$?
fi
set -e

if [ "$rc" -ne 0 ]; then
  log "ERROR: claude exited $rc"
  post_failure "Ralph deep analysis failed: claude exited $rc"
  exit 5
fi

# --- AC-H8: validate JSON -------------------------------------------------

if [ ! -f "$TRIAGE_JSON_FILE" ]; then
  log "ERROR: $TRIAGE_JSON_FILE not produced"
  post_failure "Ralph finished but did not produce $TRIAGE_JSON_FILE"
  exit 6
fi

# 10-field schema check
if ! jq -e '
    (.decision | type == "string") and
    (.decision | IN("bug"; "feature"; "duplicate"; "out-of-scope"; "needs-info")) and
    (.confidence | type == "number") and
    (.confidence >= 0 and .confidence <= 1) and
    (.summary | type == "string" and length >= 10) and
    (.rationale | type == "string" and length >= 10) and
    (.related_issues | type == "array") and
    (.size | IN("S"; "M"; "L"; "XL")) and
    (.size_rationale | type == "string") and
    (.acceptance_criteria | type == "array") and
    (.risks | type == "array") and
    (.suggested_labels | type == "array")
  ' "$TRIAGE_JSON_FILE" >/dev/null; then
  log "ERROR: schema validation failed for $TRIAGE_JSON_FILE"
  post_failure "Ralph output failed 10-field schema validation"
  exit 6
fi

# AC-S2: acceptance_criteria non-empty IFF decision ∈ {bug, feature}
if ! jq -e '
    ((.decision == "bug" or .decision == "feature") == (.acceptance_criteria | length > 0))
  ' "$TRIAGE_JSON_FILE" >/dev/null; then
  log "ERROR: AC-S2 consistency check failed (acceptance_criteria vs decision)"
  post_failure "Ralph output failed AC-S2 consistency (acceptance_criteria non-empty IFF decision is bug/feature)"
  exit 6
fi

# AC-S3: related_issues non-empty IFF decision == duplicate
if ! jq -e '
    ((.decision == "duplicate") == (.related_issues | length > 0))
  ' "$TRIAGE_JSON_FILE" >/dev/null; then
  log "ERROR: AC-S3 consistency check failed (related_issues vs decision)"
  post_failure "Ralph output failed AC-S3 consistency (related_issues non-empty IFF decision is duplicate)"
  exit 6
fi

log "schema validation passed"

# --- AC-H9 + comment composition ------------------------------------------

DECISION="$(jq -r '.decision' "$TRIAGE_JSON_FILE")"
CONFIDENCE="$(jq -r '.confidence' "$TRIAGE_JSON_FILE")"
SUMMARY="$(jq -r '.summary' "$TRIAGE_JSON_FILE")"
RATIONALE="$(jq -r '.rationale' "$TRIAGE_JSON_FILE")"
SIZE="$(jq -r '.size' "$TRIAGE_JSON_FILE")"
SIZE_RATIONALE="$(jq -r '.size_rationale' "$TRIAGE_JSON_FILE")"
RELATED="$(jq -r '.related_issues | map("#" + (.|tostring)) | join(", ")' "$TRIAGE_JSON_FILE")"
ACCEPTANCE_CRITERIA="$(jq -r '.acceptance_criteria | map("- " + .) | join("\n")' "$TRIAGE_JSON_FILE")"
RISKS="$(jq -r '.risks | map("- " + .) | join("\n")' "$TRIAGE_JSON_FILE")"
SUGGESTED_LABELS="$(jq -r '.suggested_labels' "$TRIAGE_JSON_FILE")"

# Detect overturn: cloud emitted 'work' but ralph said duplicate/out-of-scope/needs-info,
# OR cloud emitted 'reply' but ralph said bug/feature.
# Cloud decision isn't always recoverable post-hoc, so use label presence
# as a proxy: issue was queued to ralph (this script only runs on needs-ralph).
# We treat any ralph decision of duplicate/out-of-scope/needs-info as a
# potential overturn relative to a likely 'work' cloud first-pass.
OVERTURN_PREAMBLE=""
case "$DECISION" in
  duplicate|out-of-scope|needs-info)
    OVERTURN_PREAMBLE="⚠️ **Ralph overturns cloud first-pass** — deeper analysis suggests this issue is \`${DECISION}\` rather than a straightforward work item.

"
    ;;
esac

# Format acceptance criteria section
AC_SECTION=""
if [ -n "$ACCEPTANCE_CRITERIA" ]; then
  AC_SECTION="### Acceptance criteria (draft)
${ACCEPTANCE_CRITERIA}

"
fi

RISKS_SECTION=""
if [ -n "$RISKS" ]; then
  RISKS_SECTION="### Risks
${RISKS}

"
fi

RELATED_SECTION=""
if [ -n "$RELATED" ] && [ "$RELATED" != "#" ]; then
  RELATED_SECTION="### Related
${RELATED}

"
fi

# --- AC-H11: filter suggested_labels (allow-list, deny-list) --------------

# Hard-coded deny-list of state labels — never applied by wrapper.
DENY_LIST=(accepted rejected stage:failed design-approved needs-info triage triage-done needs-ralph)

# Allow-list: any label defined in .github/labels.yml minus deny-list.
ALLOW_LIST_FILE="$STATE_DIR/labels-allow.txt"
gh label list --repo "$GITHUB_REPO" --json name --limit 200 \
  | jq -r '.[].name' \
  | while IFS= read -r lbl; do
      skip=0
      for deny in "${DENY_LIST[@]}"; do
        if [ "$lbl" = "$deny" ]; then skip=1; break; fi
      done
      [ "$skip" = 0 ] && printf '%s\n' "$lbl"
    done > "$ALLOW_LIST_FILE"

APPLIED_LABELS=()
SKIPPED_LABELS=()
if [ -n "$SUGGESTED_LABELS" ] && [ "$SUGGESTED_LABELS" != "null" ]; then
  while IFS= read -r lbl; do
    [ -z "$lbl" ] && continue
    if grep -qxF "$lbl" "$ALLOW_LIST_FILE"; then
      APPLIED_LABELS+=("$lbl")
    else
      SKIPPED_LABELS+=("$lbl")
    fi
  done < <(printf '%s' "$SUGGESTED_LABELS" | jq -r '.[]')
fi

APPLIED_LIST="${APPLIED_LABELS[*]:-}"
SKIPPED_LIST="${SKIPPED_LABELS[*]:-}"
SUGGESTED_SECTION=""
if [ -n "$APPLIED_LIST" ] || [ -n "$SKIPPED_LIST" ]; then
  SUGGESTED_SECTION="### Suggested labels
"
  if [ -n "$APPLIED_LIST" ]; then
    SUGGESTED_SECTION="${SUGGESTED_SECTION}Applied: \`${APPLIED_LIST// /, }\`

"
  fi
  if [ -n "$SKIPPED_LIST" ]; then
    SUGGESTED_SECTION="${SUGGESTED_SECTION}Skipped (state label or unknown): \`${SKIPPED_LIST// /, }\`

"
  fi
fi

# --- Compose comment body -------------------------------------------------

read -r -d '' COMMENT_BODY <<EOF || true
## 🤖 Ralph deep analysis (confidence: ${CONFIDENCE})

${OVERTURN_PREAMBLE}**Decision:** ${DECISION}
**Size:** ${SIZE} — ${SIZE_RATIONALE}

${SUMMARY}

### Rationale
${RATIONALE}

${AC_SECTION}${RISKS_SECTION}${RELATED_SECTION}${SUGGESTED_SECTION}---
Maintainer: apply \`accepted\` to proceed, or \`rejected\` to close.
EOF

# --- AC-H10: post comment + apply triage-done + remove needs-ralph --------

log "posting comment to issue #$ISSUE_NUMBER"
printf '%s\n' "$COMMENT_BODY" | gh issue comment "$ISSUE_NUMBER" --repo "$GITHUB_REPO" --body-file -

# Apply suggested non-state labels (AC-H11) — single gh call, comma-separated.
if [ -n "$APPLIED_LIST" ]; then
  comma_labels="${APPLIED_LIST// /,}"
  log "applying suggested labels: $comma_labels"
  # AC-H13 pre-check: assert no denied label sneaks in here
  for lbl in "${APPLIED_LABELS[@]}"; do
    for deny in "${DENY_LIST[@]}"; do
      if [ "$lbl" = "$deny" ]; then
        log "ERROR: AC-H13 violation — about to apply denied label '$lbl'; aborting"
        exit 7
      fi
    done
  done
  gh issue edit "$ISSUE_NUMBER" --repo "$GITHUB_REPO" --add-label "$comma_labels"
fi

# Apply triage-done (the one state label the wrapper IS allowed to apply —
# it signals "ralph finished"; this is the ralph path's own state transition).
gh issue edit "$ISSUE_NUMBER" --repo "$GITHUB_REPO" --add-label triage-done

# Remove needs-ralph (consumed).
gh issue edit "$ISSUE_NUMBER" --repo "$GITHUB_REPO" --remove-label needs-ralph || true

log "issue #$ISSUE_NUMBER: triage complete"
exit 0
