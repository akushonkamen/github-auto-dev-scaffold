# CLAUDE.md — AI agent architecture map

> First-read map for any AI agent (Claude Code, Codex) working in this repo.
> PRD §8 item 4 mandates this file: it provides the architecture context the
> agent needs to act safely without reading the whole repository (PRD §5 context budget).

## Project overview

**GithubAutoDev** is an AI-driven Issue → Merge automation pipeline. A GitHub
Issue flows through 10 modules (triage → judgement → design → develop → verify
→ test → PR → review → merge). Modules communicate **only** via GitHub events
and Label transitions — they never call each other directly. The Label taxonomy
is the protocol layer.

Authoritative PRD lives at [`PRD.md`](./PRD.md) (drop it there). Pipeline
overview at [`docs/architecture.md`](docs/architecture.md).

## Repository layout

```
.github/
  workflows/      # one workflow per PRD module (triggers + glue)
  actions/        # composite actions — engine-agnostic module wrappers
    triage/         Module 2
    judge/          Module 3 (chokepoint, PRD §8 item 2)
    design-review/  Module 3.5
    develop/        Module 4
    self-verify/    Module 5
    test/           Module 6
    pr-open/        Modules 7+8
  ISSUE_TEMPLATE/ # structured Issue Forms (Module 1)
  CODEOWNERS      # review ownership (Module 8)
  labels.yml      # machine-readable Label taxonomy
  dependabot.yml
docs/
  architecture.md          # pipeline overview + module/engine/trigger matrix
  labels.md                # Label state machine full definition (PRD §8 item 1)
  triage-modes.md          # auto/manual/hybrid modes + threshold calibration
  composite-action-spec.md # interface spec for every composite action (PRD §8 item 3)
  security.md              # security red lines operational guide
CLAUDE.md                  # this file
README.md
```

`py/` and `rust/` source trees are out of scope for this scaffold — they will
house the product code once the pipeline is wired. **Do not invent files in
those directories**; the Issue/PR will name the directories that matter.

## Module map (condensed PRD §2)

| # | Module | Engine | Trigger | Output Label |
|---|---|---|---|---|
| 1 | Issue Forms | GitHub native | `issues.opened` | structured Issue |
| 2 | Triage | Claude (cloud first-pass, GLM passthrough) | Module 1 event | `triage` + conditional `accepted-by-claude` (trivial/standard) or `needs-clarify` (complex) |
| 3' | Clarify loop | Claude (multi-turn, GLM passthrough) | `labeled: needs-clarify` or issue author comment | `accepted-by-claude` \| `yielded` \| `needs-ralph` (max-rounds fallback only — local ralph path) |
| 3 | Judgement (REMOVED) | — | — | Module 3 workflow + composite action deleted. `needs-ralph` label still used as escalation signal but no cloud workflow fires on it. |
| 3.5 | Design review | Claude (+human) | size:XL accepted | `design-approved` |
| 4 | Develop (M4 split) | Claude (GLM passthrough) | `workflow_run: clarify-loop completed` | develop-gate → code-generate → pr-lifecycle |
| 5 | verify.yml (cutover LIVE) | Claude (2-oracle smoke + targeted, GLM passthrough) | branch push (PR opened on claude/issue-*) | verify report + `verified` / `verify:failed` label. self-verify.yml deleted in cutover. |
| 6 | Test | Claude (second isolated process, tool-restricted tester — PRD §4 amendment 2026-07-07) | Module 5 passed | test report |
| 7 | PR open (REMOVED) | — | — | Module 7 v1 deleted. `pr-lifecycle.yml` (M4c) opens PR + applies `in-review` directly. |
| 8 | Review | Claude + CODEOWNERS | `pull_request.labeled: in-review` | Approve / Changes |
| 9 | Merge | Merge Queue | approved + green | merge + close |

Full table + transition rules in [`docs/labels.md`](docs/labels.md) and
[`docs/architecture.md`](docs/architecture.md).

## Label state machine (5-line summary)

- `triage` → (`needs-clarify` → Module 3' clarify loop → `accepted-by-claude`|`yielded`) → `accepted`|`rejected` (maintainer only) → (optional `design-approved`) → `verifying` → `verified`|`verify:failed` → `testing` → `tested` → `in-review` (applied by pr-lifecycle) → `merged`. Escalation: `needs-ralph` (max-rounds, local-only) — no cloud workflow fires on it.
- Anywhere → `stage:failed` (graceful degradation, PRD §6)
- `force-manual` overrides global `TRIAGE_MODE` per-issue (PRD §3)
- Full state diagram, owners, legal transitions: [`docs/labels.md`](docs/labels.md)

## Security red lines (PRD §7, verbatim + v2 amendments)

These take precedence over every feature. If a workflow change conflicts with
any of them, the red line wins.

- **S1** — Triage/judge workflows: `permissions: contents: read, issues: write`. NEVER `contents: write`. Issue bodies are untrusted input.
- **S2** — Module 4 (develop) triggers on `labeled: accepted` (maintainer) OR `labeled: accepted-by-claude` (Claude self-acceptance via S2 amendment). Only maintainers may apply `accepted`; `accepted-by-claude` may be applied by (a) `triage-issue.yml` for `workload_class: trivial|standard` (M8 amendment — low-risk self-acceptance) and (b) `clarify-loop.yml` dispatch shell for any workload class.
- **S3** — AI code never lands on `main`. Secrets scoped per-module, never workflow-global.
- **S4** — AI must never print tokens, API keys, or environment values.
- **S5** — No sandbox bypass. Codex uses `permission-profile: workspace-write` (never `danger-full-access`). Claude uses `--allowedTools` whitelist (never `--dangerously-skip-permissions`).
- **S6** — Personal access token (PAT) handling. Fine-grained PAT only, single-repo scope, minimal permissions, time-bounded (max 90 days), audit log monitoring. Classic PATs forbidden. See [`docs/security.md`](docs/security.md) §S6.
- **S7** — Pipeline-fix escape hatch. The dogfooding rule (all changes via Issue→PR pipeline) is enforced by branch protection on `dev`/`main`. The single sanctioned bypass is the `pipeline-fix` label on a direct PR, applied by the maintainer, scoped to `.github/workflows/` + `.github/actions/` + `docs/security.md`, with mandatory audit comment. See [`docs/security.md`](docs/security.md) §S7.

See [`docs/security.md`](docs/security.md) for the operational playbook and incident response.

## Context budget rules (PRD §5)

- **Do NOT read the whole repository.** AI agent reads only directories explicitly named in the Issue/PR body.
- The composite action's `context-budget-paths` input lists the allowed paths; an empty value defers to this file.
- Cap turns via the `max-turns` input (defaults: 6-20 per module). Never raise above 30 without explicit Issue scope.
- If you need a directory not named in the Issue, ask via a comment rather than scanning.
- Prefer `Grep` / `Glob` over `Read` of large files. Read the architecture map here, not the source.

## Engine configuration

- Engines are selected per module via the `engine` input on each composite action (`claude` \| `codex`).
- Default engines: Claude for modules 2/3/4/8; Codex for module 6 (PRD §4 — out-of-distribution tester).
- Model IDs are configurable via the `model` input on every action. Defaults:
  - Claude: `claude-opus-4-7` (heavy) / `claude-sonnet-4-6` (standard) / `claude-haiku-4-5` (lookup)
  - Codex: `gpt-5` family
- Fallback chain: if the chosen model is unavailable, fall back one tier (Opus → Sonnet → Haiku). Document any fallback in the audit comment.
- API keys per engine: `LLM_API_KEY` (provider-neutral — GLM passthrough by default via `vars.ANTHROPIC_BASE_URL`), `OPENAI_API_KEY` (Codex engine) — scoped per-job, never workflow-global (S3).

## References

- [PRD (drop here as `PRD.md`)](./PRD.md) — authoritative spec
- [docs/architecture.md](docs/architecture.md) — pipeline overview
- [docs/labels.md](docs/labels.md) — Label state machine
- [docs/triage-modes.md](docs/triage-modes.md) — auto/manual/hybrid + calibration
- [docs/composite-action-spec.md](docs/composite-action-spec.md) — action interfaces
- [docs/security.md](docs/security.md) — red lines operational guide
- [docs/quickstart-triage.md](docs/quickstart-triage.md) — Issue → Claude → Reply/Work end-to-end setup (cloud first-pass)
- [docs/quickstart-clarify.md](docs/quickstart-clarify.md) — v2 clarify loop setup (PAT, repo vars, fixture walkthrough)

## Working agreement

- Make the smallest change that satisfies the Issue. No drive-by refactors.
- If you discover missing context, post a question on the Issue rather than guessing.
- If a red line conflicts with the Issue, stop and post a comment citing S1-S5.
- Every workflow change MUST keep `permissions:` explicit at workflow AND job level.
- Audit comments are mandatory for every Label transition (PRD §3 invariant).
