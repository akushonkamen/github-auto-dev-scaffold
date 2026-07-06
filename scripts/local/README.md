# Local polling stack

> **LEGACY (v2).** As of triage-clarify-v2, the cloud-side workflow handles the
> full Issue → Triage → Clarify → Develop loop end-to-end. This local stack is
> retained only as the **v1 reply-path fallback** (issues where cloud decided
> `decision==reply` and the maintainer wants local re-analysis). For new setups,
> default `POLL_ENABLED=false` and use the cloud pipeline documented in
> [`docs/quickstart-clarify.md`](../../docs/quickstart-clarify.md).
>
> Specifically, the cloud v2 pipeline replaces:
> - `handle-triage.sh` → cloud `clarify-loop.yml` (Module 3' multi-turn clarification)
> - `handle.sh`         → cloud `develop.yml` (Module 4 with CLAUDE_DEV_PAT-as-developer)
>
> Coexistence contract: `poll.sh` checks `POLL_ENABLED` env var (default
> `false`). Set `POLL_ENABLED=true` in `~/.config/githubautodev/config.sh` only
> if you need the v1 local fallback alongside the v2 cloud pipeline. The v1
> path is mutually exclusive with v2's `needs-clarify` label — see
> [`docs/labels.md#coexistence-v1--v2`](../../docs/labels.md#coexistence-v1--v2).

The hybrid architecture: **cloud-side workflow analyses + comments + labels**, **local claude code implements**. See [`docs/quickstart-triage.md`](../../docs/quickstart-triage.md) for the cloud half.

This directory contains the local half:

```
scripts/local/
├── poll.sh           # cron entry; polls for `accepted` AND `needs-ralph` issues, dispatches per label
├── handle.sh         # develop-path handler (accepted label): claude + push + PR
├── handle-triage.sh  # triage-path handler (needs-ralph label): claude + ralph → JSON + comment
└── README.md         # this file
```

## How it fits together

```
┌─ GitHub (cloud) ───────────────────────────────────────────────┐
│  Issue opened                                                  │
│    ↓                                                           │
│  triage-issue.yml workflow runs                                │
│    ↓                                                           │
│  Claude analyses (via GLM passthrough)                         │
│    ↓                                                           │
│  decision==work OR confidence<TRIAGE_RALPH_THRESHOLD ?         │
│    YES → applies `needs-ralph` + posts "queued" comment        │
│    NO  → posts reply comment (+ optional `accepted` if high)   │
└────────────────────────────────────────────────────────────────┘
                          │
                          │  (label is the handoff signal)
                          ▼
┌─ Your mac (local) ─────────────────────────────────────────────┐
│  cron → poll.sh (dual-label polling)                           │
│    ↓                                                           │
│  gh issue list --label needs-ralph  +  --label accepted        │
│    ↓                                                           │
│  per-issue dispatch:                                           │
│    • needs-ralph only → handle-triage.sh                       │
│    • accepted only    → handle.sh                              │
│    • BOTH (race)      → accepted wins (AC-P4)                  │
│    ↓                                                           │
│  handle-triage.sh: claude -p + Skill(ralph) writes JSON        │
│    ↓                                                           │
│  wrapper posts formatted comment, applies `triage-done`,       │
│  removes `needs-ralph`. Never applies `accepted` (S2).         │
└────────────────────────────────────────────────────────────────┘
```

## Polling modes (AC-P1, AC-P4)

`poll.sh` polls both `accepted` and `needs-ralph` labels in two parallel `gh issue list` calls (GitHub's compound `--label a,b` is AND, not OR — so two calls are needed). Results are merged and deduped by issue number.

**Race priority (AC-P4):** if a maintainer applies `accepted` to an issue that's still labelled `needs-ralph` (during ralph's 5-15 min window), `accepted` wins. `poll.sh` dispatches to `handle.sh` only, removes `needs-ralph`, and marks the issue seen so `handle-triage.sh` doesn't subsequently fire on it.

## One-time setup

### 1. Configure environment

Create `~/.config/githubautodev/config.sh`:

```bash
# Required
export GITHUB_REPO="akushonkamen/github-auto-dev-scaffold"
export GITHUB_TOKEN="$(gh auth token)"

# Optional overrides
export CLAUDE_BIN="claude"          # or /full/path/to/claude
export BASE_BRANCH="dev"
export DRAFT_PR="true"              # open PRs as draft by default
export MAX_TURN_MINUTES="15"
export DRY_RUN="false"              # true = run claude but skip push/PR
```

```bash
chmod 600 ~/.config/githubautodev/config.sh
chmod +x scripts/local/poll.sh scripts/local/handle.sh
```

### 2. Verify gh CLI auth

```bash
gh auth status
# Must show: ✓ Logged in to github.com account ...
```

### 3. Verify local claude

```bash
which claude
claude --version    # whatever version prints; we just want it on PATH
```

If you're using a GLM proxy locally (e.g. `ANTHROPIC_BASE_URL` set in your shell), `claude` here will use that. The local stack does **not** override your claude config — it inherits whatever your shell sets.

### 4. Manual smoke test

Before installing cron, run poll.sh once to verify wiring:

```bash
./scripts/local/poll.sh
```

Expected output on an empty repo:
```
[...] [info] polling akushonkamen/github-auto-dev-scaffold for issues labelled 'accepted'
[...] [debug] no issues labelled 'accepted' found
```

### 5. Install cron

Edit crontab:

```bash
crontab -e
```

Add (every 2 minutes — adjust to taste):

```
*/2 * * * * /Users/you/projects/GithubAutoDev/scripts/local/poll.sh >> /tmp/githubautodev-poll.log 2>&1
```

Caveat: cron has a minimal environment. If `claude`, `gh`, `jq`, or `git` aren't on cron's PATH, either:
- Prefix the cron entry with `PATH=...` (cron syntax allows env assignments before the command), or
- Source `~/.zshrc` / `~/.bashrc` from inside `config.sh`, or
- Use absolute paths in `CLAUDE_BIN`, etc.

### 6. End-to-end test

1. Open a real issue on `akushonkamen/github-auto-dev-scaffold`.
2. Wait for the cloud-side workflow to apply `accepted` (set `AUTO_ACCEPT_ENABLED=true` repo variable first, or apply `accepted` manually).
3. Within 2 minutes (cron cadence), poll.sh picks it up.
4. Watch `/tmp/githubautodev-poll.log` for progress.
5. Final state: a new draft PR linked to the issue.

## State files

```
$XDG_STATE_HOME/githubautodev/   (default: ~/.local/state/githubautodev/)
├── seen.txt           # issue numbers successfully handled (either path)
├── failed.txt         # develop-path (handle.sh) failures
├── triage-failed.txt  # triage-path (handle-triage.sh) failures
├── poll.lock.d/       # mkdir-based single-flight lock (auto-removed on exit)
└── handle-triage-N.lock.d/  # per-issue lock (prevents concurrent handle-triage.sh on same issue)

$PROJECT_ROOT/.omc/state/   (per-project analysis state — gitignored)
├── triage-prd-N.md          # ralph PRD scaffold for issue #N (wrapper-authored)
├── triage-issue-N.json      # ralph's structured analysis output (10-field schema)
└── labels-allow.txt         # cache of repo labels minus deny-list (used by AC-H11)
```

To **retry** a failed issue:

```bash
sed -i.bak '/^42$$/d' ~/.local/state/githubautodev/failed.txt
```

To **re-run** a successfully handled one (e.g. you merged the PR but the issue reopened):

```bash
sed -i.bak '/^42$/d' ~/.local/state/githubautodev/seen.txt
```

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `claude binary not found` | `CLAUDE_BIN` not on cron's PATH | Set `CLAUDE_BIN=/absolute/path` in config.sh |
| `uncommitted changes in $PROJECT_ROOT` | You have local edits | Commit or stash before next poll |
| `claude exited non-zero` | Local claude error (model, prompt, MCP) | Re-run `claude -p` manually to reproduce |
| `produced no commits` | Claude succeeded but didn't commit | Re-run; check if claude needs an explicit "commit" instruction |
| `push rejected (non-fast-forward)` | Branch diverged | Delete local `feat/issue-N` and re-run |
| `Could not resolve host` inside cron | Minimal cron env | Source `~/.zshrc` from config.sh |
| `handle-triage.sh: schema validation failed` | Ralph output JSON doesn't match 10-field schema or AC-S2/S3 consistency | Inspect `.omc/state/triage-issue-N.json`; re-queue by removing/re-adding `needs-ralph` |
| `AC-H13 violation` | Wrapper attempted to apply a denied label (accepted/rejected/etc.) | This is a wrapper bug — open an issue; ralph output should never include state labels in suggested_labels |
| `Issue already accepted; ralph analysis skipped` (AC-H14) | Maintainer raced ralph and applied `accepted` first | Expected behavior; no action needed |

## Security notes

- `GITHUB_TOKEN` lives in `~/.config/githubautodev/config.sh` — file mode 600.
- The local claude CLI runs as **your user** with **all your MCP servers and tools**. This is more powerful than the cloud-side action (which is sandboxed). Only run this on machines you trust.
- `poll.sh` does NOT pull issue bodies into the local working tree — only into a `mktemp` file that's removed on exit.
- The PR body contains the issue URL but never the issue body verbatim (avoids re-rendering untrusted content).
