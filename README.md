# GithubAutoDev

AI-driven **Issue → Merge** automation pipeline built on Claude Code, Codex, and GitHub Actions.

## What this repo is

A modular pipeline that takes a GitHub Issue through its full lifecycle — triage, judgement, design review, development, verification, testing, PR, review, merge — using AI agents wired together by **Label state machine** events. See the PRD module table for the 10-stage breakdown.

## Quick setup

Bootstrap a target repo for the pipeline with the interactive wizard:

```bash
cd scripts/setup
npm install
node wizard.mjs --dry-run       # preview every step (recommended first run)
node wizard.mjs                 # interactive, executes after each confirm
```

The wizard handles secrets, repo vars, labels sync, CODEOWNERS, and branch protection. See [`scripts/setup/README.md`](scripts/setup/README.md) for the full step list and troubleshooting.

For the manual equivalent on a single module, follow [`docs/quickstart-triage.md`](docs/quickstart-triage.md) (triage flow) or [`docs/quickstart-clarify.md`](docs/quickstart-clarify.md) (v2 clarify loop).

## Architecture principles

- **Loose coupling.** Modules communicate only via GitHub events + Label transitions. No direct module-to-module calls.
- **Label state machine = Kanban.** Each Label is a protocol primitive. See [`docs/labels.md`](docs/labels.md).
- **Engine swap is one variable.** Composite actions wrap `claude-code-action` and `codex-action` behind a common interface. See [`docs/composite-action-spec.md`](docs/composite-action-spec.md).
- **Security red lines take precedence over features.** See [`docs/security.md`](docs/security.md) and `CLAUDE.md`.

## Repository layout

```
.github/
  workflows/      # one workflow per PRD module
  actions/         # composite actions (engine-agnostic wrappers)
  ISSUE_TEMPLATE/  # structured Issue Forms (PRD §2 module 1)
docs/              # protocol + spec docs (the source of truth)
CLAUDE.md          # AI agent architecture map
```

`py/` and `rust/` source trees are out of scope for this scaffold — they will house the actual product code once the pipeline is wired.

## Quick links

- [PRD (authoritative)](./PRD.md) — drop the PRD here as `PRD.md` to make the link live
- [Label state machine](docs/labels.md)
- [Triage modes (auto/manual/hybrid)](docs/triage-modes.md)
- [Composite action spec](docs/composite-action-spec.md)
- [Security](docs/security.md)
- [Architecture](docs/architecture.md)
- [Hybrid threshold calibration](docs/triage-modes.md#calibration)

## Status

🚧 Pipeline scaffold in progress. See `.omc/state/sessions/*/prd.json` for the active work breakdown.
