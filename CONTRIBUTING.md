# Contributing

This repo runs a **hybrid cloud + local** pipeline. Issues are triaged in the
cloud; implementation runs on a contributor's machine.

## Two halves

1. **Cloud side** — when an issue is opened, the
   [`triage-issue`](./.github/workflows/triage-issue.yml) workflow runs Claude,
   posts an analysis comment, and (if `AUTO_ACCEPT_ENABLED=true`) applies the
   `accepted` label. Setup: [`docs/quickstart-triage.md`](./docs/quickstart-triage.md).
2. **Local side** — a poller on your machine watches for issues labelled
   `accepted`, runs the local `claude` CLI on a feature branch, pushes, and
   opens a draft PR. Setup: [`scripts/local/README.md`](./scripts/local/README.md).

The `accepted` label is the handoff signal between the two.

## Getting started

1. Cloud setup (API key, optional GLM passthrough, optional auto-accept):
   see [`docs/quickstart-triage.md`](./docs/quickstart-triage.md).
2. Local setup (PAT, env file, cron entry):
   see [`scripts/local/README.md`](./scripts/local/README.md).
3. PAT and `GITHUB_TOKEN` live in `~/.config/githubautodev/config.sh`
   (mode `600`). Never paste them into issues, PRs, or shell history
   (PRD §7 S4).

## Quick test

After both halves are configured:

1. Open a trivial test issue (e.g. "docs: fix a typo in README").
2. Cloud side: within ~1–2 minutes the triage workflow comments and applies
   `accepted` (if auto-accept is on; otherwise apply `accepted` by hand).
3. Local side: within ~2 minutes of the label, `poll.sh` picks it up and
   `handle.sh` opens a draft PR.
4. Tails: `/tmp/githubautodev-poll.log` (local) and the Actions tab (cloud).

## Conventions

- Smallest change that satisfies the issue. No drive-by refactors.
- Branches: `feat/issue-N`, `fix/issue-N`. Never commit to `main`/`dev`/`master`.
- Every label transition posts an audit comment (PRD §3).
- Security red lines S1–S5 in [`docs/security.md`](./docs/security.md) override
  any feature request.

## Where to look next

- [`CLAUDE.md`](./CLAUDE.md) — architecture map for AI agents.
- [`docs/architecture.md`](./docs/architecture.md) — full module matrix.
- [`docs/labels.md`](./docs/labels.md) — label state machine.
