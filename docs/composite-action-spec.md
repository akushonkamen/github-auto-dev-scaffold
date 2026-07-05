# Composite action interface specification

> PRD §8 item 3. Every module (2, 3, 3.5, 4, 5, 6, 7, 8) is wrapped by a composite action in `.github/actions/<module>/`. The composite action is **engine-agnostic**: it dispatches to `claude-code-action` or `codex-action` based on the `engine` input. Swapping the engine for a module is a one-variable change at the call site (PRD §4).

## Common interface

Every module action shares these inputs and outputs so they compose uniformly. Module-specific inputs are layered on top.

> **Scaffold status:** COMMON inputs are declared on every action per the contract. `repo-token`, `engine`, `api-key`, and `max-turns` are wired into the underlying engine action. `model`, `context-budget-paths`, and `dry-run` are accepted but **pending wiring** — they will be threaded into the engine action call once the production engine integration lands. Tracking: replace this note with the wiring commit SHA when complete.

### Common inputs

| Input | Type | Required | Default | Wired? | Description |
|---|---|---|---|---|---|
| `repo-token` | string | yes | — | yes | `GITHUB_TOKEN` scoped for the module's needs |
| `engine` | string | no | `claude` | yes | `claude` \| `codex`. Selects the underlying LLM action |
| `api-key` | string | yes | — | yes | Provider key matching the engine (ANTHROPIC / OPENAI) |
| `model` | string | no | `""` | pending | Model ID override; empty = engine default + fallback chain per CLAUDE.md |
| `max-turns` | string | no | `8` | yes | Hard cap on agent turns (PRD §5 运行上限) |
| `context-budget-paths` | string | no | `""` | pending | Space-separated allowlist of paths the agent may read |
| `dry-run` | string | no | `false` | pending | If true, do not post comments, apply labels, or write files |

### Common outputs

| Output | Type | Description |
|---|---|---|
| `stage` | string | Lifecycle label the module reached (e.g. `accepted`, `verifying`, `merged`) |
| `audit-comment-url` | string | URL of the audit comment posted on the Issue / PR (PRD §3 Audit invariant) |

## Per-module spec

### Module 2 — triage (`/.github/actions/triage/`)

| Aspect | Value |
|---|---|
| Description | First-response, dedupe, clarification question, routing label. Engine-agnostic; supports GLM 5.2 passthrough via `anthropic-base-url` input. |
| Trigger | `issues.opened` |
| Inputs | common + `issue-number` (string, required), `anthropic-base-url` (string, default `""`) |
| Outputs | common + `decision` (`reply` \| `work`), `comment_body` (multi-line markdown), `suggested_labels` (comma-sep), `confidence` (float) |
| Secrets | `repo-token`, `api-key` (Zhipu key when using GLM passthrough) |
| Permissions | `contents: read`, `issues: write` (PRD S1) |
| Runner | `ubuntu-latest` |
| Caches | none |
| Comment posting | Action does **not** post — caller workflow decides (see `.github/workflows/triage-issue.yml`) |
| Idempotency | Re-run overwrites prior triage output via step-output recomputation; caller dedupes comments by HTML marker if needed |
| Failure | `extract.sh` exits non-zero on schema violation → workflow's `on-failure` job posts `stage:failed` |

> **Wired in this scaffold**: `.github/workflows/triage-issue.yml` calls this action end-to-end with GLM passthrough. See [`docs/quickstart-triage.md`](quickstart-triage.md) for setup.

### Module 3 — judge (`/.github/actions/judge/`)

| Aspect | Value |
|---|---|
| Description | Decide `accepted` \| `rejected` \| `needs-info` per mode (auto/manual/hybrid) |
| Trigger | `issues.labeled: triage-done` |
| Inputs | common + `issue-number` (required), `mode` (`auto` \| `manual` \| `hybrid`, required), `confidence-threshold` (default `0.7`) |
| Outputs | common + `decision`, `confidence` (float), `reason` (string) |
| Secrets | `repo-token`, `api-key` |
| Permissions | `contents: read`, `issues: write` (PRD S1 — NO `contents: write`) |
| Runner | `ubuntu-latest` |
| Idempotency | Re-run overwrites audit comment; label transition is atomic |
| Failure | Apply `stage:failed`, remove `triage-done`, post error comment |

### Module 3.5 — design-review (`/.github/actions/design-review/`)

| Aspect | Value |
|---|---|
| Description | For `size:XL` accepted issues, produce design proposal + solicit approval |
| Trigger | `issues.labeled: design-review` |
| Inputs | common + `issue-number` (required), `proposal-format` (`markdown` \| `doc`, default `markdown`) |
| Outputs | common + `proposal-path` (string, repo-relative) |
| Secrets | `repo-token`, `api-key` |
| Permissions | `contents: write` (writes design doc to `docs/designs/`), `issues: write` |
| Runner | `ubuntu-latest` |
| Idempotency | One proposal per issue; subsequent runs append revisions |

### Module 4 — develop (`/.github/actions/develop/`)

| Aspect | Value |
|---|---|
| Description | Create feature branch, implement, write impl notes |
| Trigger | `issues.labeled: accepted` (PRD S2 — gate) |
| Inputs | common + `issue-number` (required), `base-branch` (default `dev`), `runner-image` (default `ubuntu-latest`) |
| Outputs | common + `branch-name` (string), `impl-notes-path` (string) |
| Secrets | `repo-token`, `api-key` |
| Permissions | `contents: write` (branch creation), `issues: write` |
| Runner | larger runner (PRD §5) — Rust-capable; configurable via input |
| Caches | `sccache` (Rust), `uv` (Python) |
| Idempotency | Re-run on existing branch appends commits; never force-pushes |
| Failure | Apply `stage:failed`; comment with last commit + log URL |

### Module 5 — self-verify (`/.github/actions/self-verify/`)

| Aspect | Value |
|---|---|
| Description | Run static checks + build per language (PRD §5 quality gate) |
| Trigger | branch push |
| Inputs | common + `branch-name` (required), `languages` (comma-sep, default `python,rust`) |
| Outputs | common + `report-path` (string), `passed` (bool) |
| Secrets | `repo-token` (read-only) |
| Permissions | `contents: read`, `pull-requests: write` (annotate) |
| Runner | larger runner with sccache |
| Caches | `sccache`, `uv`, `cargo` |
| Idempotency | Re-run replaces report |
| Failure | Apply `stage:failed`; do NOT let downstream modules run |

### Module 6 — test (`/.github/actions/test/`)

| Aspect | Value |
|---|---|
| Description | Generate test cases (Codex by default), run selective CI |
| Trigger | Module 5 passed |
| Inputs | common + `branch-name` (required), `selective-paths` (string) |
| Outputs | common + `report-path`, `coverage-pct` (float) |
| Secrets | `repo-token`, `api-key` |
| Permissions | `contents: read`, `checks: write`, `pull-requests: write` |
| Runner | larger runner |
| Caches | `sccache`, `uv`, `cargo` |
| Idempotency | Re-run replaces report |
| Failure | Apply `stage:failed` |

### Module 7/8 — pr-open + review (`/.github/actions/pr-open/`)

| Aspect | Value |
|---|---|
| Description | Open PR with linked-issue body, then run AI initial review |
| Trigger | Module 6 passed (open); `pull_request.opened` (review) |
| Inputs | common + `branch-name` (required), `issue-number` (required), `draft` (default `true`) |
| Outputs | common + `pr-url`, `pr-number` |
| Secrets | `repo-token`, `api-key` |
| Permissions | `contents: read`, `pull-requests: write` |
| Runner | `ubuntu-latest` |
| Idempotency | Re-run edits existing PR body |
| Failure | Apply `stage:failed` |

### Module 9 — merge (workflow only, no composite action)

Module 9 uses GitHub Merge Queue natively. No composite action is defined — the workflow `.github/workflows/merge-queue.yml` (out of scope for this scaffold) gates on `in-review` + checks + approval and uses `gh pr merge`.

## Engine swap

To swap a module from Claude to Codex, the caller changes one input:

```yaml
- uses: ./.github/actions/<module>
  with:
    engine: codex           # was 'claude'
    api-key: ${{ secrets.OPENAI_API_KEY }}   # was ANTHROPIC_API_KEY
```

The composite action handles dispatch via `if: inputs.engine == 'codex'` branches. No caller-side workflow edit beyond the input swap is required (PRD §4 'composite action 封装使切换成本为一次配置改动').

## Failure semantics (uniform)

Every composite action follows the same failure pattern:

1. Catch the error.
2. Apply `stage:failed` label (or post a comment if labels are unavailable).
3. Post an audit comment with: error class, failing step, log URL, run URL.
4. Exit non-zero so the workflow's `on-failure` job takes over (see `judge.yml`).

This guarantees PRD §6 失败降级 (graceful degradation) — a failing module never blocks other issues.
