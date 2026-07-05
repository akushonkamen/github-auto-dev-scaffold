# Local polling stack

The hybrid architecture: **cloud-side workflow analyses + comments + labels**, **local claude code implements**. See [`docs/quickstart-triage.md`](../../docs/quickstart-triage.md) for the cloud half.

This directory contains the local half:

```
scripts/local/
├── poll.sh     # cron entry; polls for `accepted` issues and dispatches
├── handle.sh   # per-issue handler; calls local claude CLI, pushes, opens PR
└── README.md   # this file
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
│  Posts comment + applies `accepted` label (if AUTO_ACCEPT_ON)  │
└────────────────────────────────────────────────────────────────┘
                          │
                          │  (label is the handoff signal)
                          ▼
┌─ Your mac (local) ─────────────────────────────────────────────┐
│  cron → poll.sh                                                │
│    ↓                                                           │
│  gh issue list --label accepted                                │
│    ↓                                                           │
│  new issue? → handle.sh                                        │
│    ↓                                                           │
│  fetch issue body, create feat/issue-N branch                  │
│    ↓                                                           │
│  invoke local `claude` CLI (uses your GLM 5.2 proxy config)    │
│    ↓                                                           │
│  push branch + open draft PR                                   │
└────────────────────────────────────────────────────────────────┘
```

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
├── seen.txt        # issue numbers successfully handled
├── failed.txt      # issue numbers whose handle.sh exited non-zero
└── poll.lock.d/    # mkdir-based single-flight lock (auto-removed on exit)
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

## Security notes

- `GITHUB_TOKEN` lives in `~/.config/githubautodev/config.sh` — file mode 600.
- The local claude CLI runs as **your user** with **all your MCP servers and tools**. This is more powerful than the cloud-side action (which is sandboxed). Only run this on machines you trust.
- `poll.sh` does NOT pull issue bodies into the local working tree — only into a `mktemp` file that's removed on exit.
- The PR body contains the issue URL but never the issue body verbatim (avoids re-rendering untrusted content).
