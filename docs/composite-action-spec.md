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
| Outputs | common + `decision` (`reply` \| `work`), `comment_body` (multi-line markdown), `suggested_labels` (comma-sep), `confidence` (float), `workload_class` (`trivial` \| `standard` \| `complex`, M3 of pipeline-redesign-v3, defaults to `standard` if engine omits) |
| Secrets | `repo-token`, `api-key` (Zhipu key when using GLM passthrough) |
| Permissions | `contents: read`, `issues: write` (PRD S1) |
| Runner | `ubuntu-latest` |
| Caches | none |
| Comment posting | Action does **not** post — caller workflow decides (see `.github/workflows/triage-issue.yml`) |
| Idempotency | Re-run overwrites prior triage output via step-output recomputation; caller dedupes comments by HTML marker if needed |
| Failure | `extract.sh` exits non-zero on schema violation → workflow's `on-failure` job posts `stage:failed` |

> **Wired in this scaffold**: `.github/workflows/triage-issue.yml` calls this action end-to-end with GLM passthrough. See [`docs/quickstart-triage.md`](quickstart-triage.md) for setup.

> **M3 (pipeline-redesign-v3) — `workload_class`**: triage now emits a third classification axis alongside `decision` and `confidence`. M6 will use this to replace the binary `AUTO_ACCEPT_ENABLED` repo var — `trivial`+`standard` may auto-accept, `complex` requires maintainer. Today no consumer reads this field; it is additive. Fixture samples: [`.github/actions/triage/test/fixtures/`](../blob/dev/.github/actions/triage/test/fixtures/).

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

> **Shipped.** v2 composite action with Claude engine, GLM passthrough support, and sealed JSON output schema.

| Aspect | Value |
|---|---|
| Description | Verify implementation against issue acceptance criteria using Claude; emit maintainer-readable report + label transition |
| Trigger | `pull_request.opened` / `.synchronize` on `claude/issue-*` branches targeting `dev` |
| Inputs | common + `issue-number` (required), `head-branch` (required), `base-branch` (required), `pr-url` (required), `anthropic-base-url` (optional), `issue-language` (optional, default `"en"`) |
| Outputs | `verify-status` (`passed` \| `failed`), `verify-report` (multi-line, max 2000 chars), `commit-sha` (string) |
| Secrets | `repo-token`, `api-key` (DEEPSEEK_API_KEY for GLM passthrough) |
| Permissions | `contents: read`, `issues: write`, `pull-requests: write` (PRD S1 — NO contents:write) |
| Runner | `ubuntu-latest` |
| Caches | none |
| Idempotency | Re-run on PR synchronize replaces prior verify report; label transition is atomic |
| Failure | Apply `verify:failed` label; `stage:failed` on infrastructure error; do NOT block downstream modules |
| Prompt contract | Input: issue body + PR diff + acceptance criteria. Output: JSON `{verify_status, verify_report, failures}` per sealed schema |
| Label transitions | `verifying` → `verified` (passed) or `verify:failed` (failed) |

### Module 6 — test (`/.github/actions/test/`)

> **Shipped (v2).** Second isolated Claude Code process with tool-restricted reviewer profile. Originally Codex per PRD §4 (OOD tester); amended 2026-07-07 to Claude due to OpenAI credential constraints — see `docs/architecture.md` §"Module 6 engine amendment".

| Aspect | Value |
|---|---|
| Description | Run existing test suite via a second isolated Claude Code process with allow `Read/Grep/Glob/Bash`, deny `Write/Edit`. Report acceptance-criteria coverage gaps. Does NOT write test files in v2. |
| Trigger | `issues.labeled: verified` (Module 5 passed) |
| Inputs | common + `issue-number` (required), `pr-url` (required), `pr-number` (required), `head-branch` (required), `base-branch` (required), `anthropic-base-url` (optional, GLM passthrough) |
| Outputs | `test-status` (`passed` \| `failed`), `test-report` (multi-line, max 2000 chars), `commit-sha` (string) |
| Secrets | `repo-token`, `api-key` (`ANTHROPIC_API_KEY` or GLM passthrough equivalent) |
| Permissions | `contents: read`, `issues: write`, `pull-requests: write` (PRD S1 — NO contents:write) |
| Runner | `ubuntu-latest` |
| Caches | none |
| Idempotency | Re-run replaces prior test report; label transition is atomic |
| Failure | Apply `test:failed` label; `stage:failed` on infrastructure error |
| Prompt contract | Input: PR diff + acceptance criteria + existing tests. Output: JSON `{test_status, test_report, failures, coverage_gaps}` per sealed schema |
| Label transitions | `verified` → `testing` → `tested` (passed) or `test:failed` (failed) |
| S5 enforcement | `settings.permissions.allow: ["Read","Grep","Glob","Bash"]`, `deny: ["Write","Edit"]` + `claude_args --disallowedTools "Write,Edit,Bash(git push*),Bash(git commit*),..."`. No `--dangerously-skip-permissions`. |

### Module 7 — pr-open (`/.github/actions/pr-open/`)

> **Shipped.** Locates the existing PR (opened by Module 4 develop), posts a ready-for-review comment, and applies `in-review` label. Does NOT create a second PR.

| Aspect | Value |
|---|---|
| Description | Locate existing PR, post ready-for-review comment with test workflow run link, apply `in-review` label to the PR |
| Trigger | `issues.labeled: tested` (Module 6 passed) |
| Inputs | common + `branch-name` (required), `issue-number` (required), `pr-number` (required), `pr-url` (required), `workflow-run-url` (optional), `anthropic-base-url` (optional) |
| Outputs | common + `pr-url`, `pr-number` |
| Secrets | `repo-token` (CLAUDE_DEV_PAT for downstream workflow triggers per PR #16), `api-key` (DEEPSEEK_API_KEY for GLM passthrough) |
| Permissions | `contents: read`, `pull-requests: write`, `issues: write` (PRD S1 — NO contents:write) |
| Runner | `ubuntu-latest` |
| Caches | none |
| Idempotency | Re-run reposts ready-for-review comment; `gh pr edit --add-label in-review` is idempotent |
| Failure | Apply `stage:failed`; comment with run URL |
| S5 enforcement | `settings.permissions.allow: ["Read","Grep","Glob","Bash(gh pr:*)"]` + deny Write/Edit/push — no `gh pr create` allowed via prompt guard |
| Label transitions | Applies `in-review` to the PR (triggers Module 8 review). Issue stays `tested` until merge per `docs/labels.md`. |

### Module 8 — review (`/.github/actions/review/`)

> **Shipped.** Claude engine composite action with DeepSeek passthrough. AI initial review posts findings as PR comment; NEVER approves.

| Aspect | Value |
|---|---|
| Description | AI initial review against CLAUDE.md, docs/security.md (S1-S7), docs/composite-action-spec.md. Posts structured findings as PR comment. AI NEVER approves — final approval is human per PRD §6. |
| Trigger | `pull_request.labeled: in-review` (Module 7 pr-open applied the label) |
| Inputs | common + `pr-number` (required), `issue-number` (required), `anthropic-base-url` (optional) |
| Outputs | `review-status` (`posted`), `audit-comment-url` (URL of the review comment) |
| Secrets | `repo-token` (CLAUDE_DEV_PAT for PR comment — PR #16 lesson), `api-key` (DEEPSEEK_API_KEY for GLM passthrough) |
| Permissions | `contents: read`, `pull-requests: write`, `issues: write` (S1 — NO contents:write) |
| Runner | `ubuntu-latest` |
| Caches | none |
| Idempotency | Re-run posts a new review comment; prior comments remain for audit trail |
| Failure | Apply `stage:failed` on infrastructure error; `on-failure` job posts comment on issue + PR |
| S5 enforcement | `settings.permissions.allow: ["Read","Grep","Glob","Bash(gh pr:*)"]` + deny Write/Edit/push — no `gh pr merge/approve/review` |
| Prompt contract | Review PR diff against CLAUDE.md, docs/security.md (S1-S7), docs/composite-action-spec.md. Post structured findings table as comment. NEVER approve. |
| Label transitions | None (review is read + comment only). Issue stays `tested` until merge per `docs/labels.md`. |

### Module 9 — merge (workflow only, no composite action)

Module 9 uses GitHub Merge Queue natively. No composite action is defined — the workflow `.github/workflows/merge-queue.yml` (out of scope for this scaffold) gates on `in-review` + checks + approval and uses `gh pr merge`.

## anthropics/claude-code-action@v1 canonical schema

> As of v1.0, `max_turns` and `allowed_tools` are **removed** as direct inputs.
> They have moved into the `settings` JSON input and `claude_args` CLI flags respectively.
>
> **Migration rule:** every composite action that calls `anthropics/claude-code-action@v1`
> MUST build a `settings` JSON via a preceding shell step and pass `settings` +
> (optionally) `claude_args`. Raw `max_turns` / `allowed_tools` on the action step
> are silently ignored by v1 — the module runs with defaults and produces nothing useful.

### Current inputs (v1)

| Input | Type | Required | Description |
|---|---|---|---|
| `anthropic_api_key` | string | yes | Anthropic API key (or provider key for passthrough) |
| `github_token` | string | yes | GitHub token scoped for the module's permissions |
| `prompt` | string | yes | The prompt / task for Claude Code to execute |
| `settings` | JSON string | recommended | Permissions + model + maxTurns + other SDK settings |
| `claude_args` | string | no | Additional CLI flags (`--json-schema`, `--disallowedTools`, etc.) |

### `settings` JSON structure

```json
{
  "permissions": {
    "allow": ["Read", "Grep", "Glob", "Bash(gh pr:*)"],
    "deny": ["Write", "Edit", "Bash(git push:*)", "Bash(git checkout main*)"]
  },
  "maxTurns": 8,
  "model": "claude-sonnet-4-6"
}
```

- `permissions.allow` replaces the old `allowed_tools` input.
- `permissions.deny` provides belt-and-suspenders blocking of dangerous tools (complements `--disallowedTools` in `claude_args`).
- `maxTurns` replaces the old `max_turns` input.
- `model` is optional; omit to use the engine default.

### `claude_args` usage

- `--json-schema '<compact-json>'` — enables structured output; read result from `steps.<id>.outputs.structured_output`.
- `--disallowedTools 'Bash(git push:*),...'` — defense in depth on top of `settings.permissions.deny`.

### Migration from v0.x

| v0.x input | v1 replacement |
|---|---|
| `max_turns` | `settings.maxTurns` (inside JSON passed to `settings` input) |
| `allowed_tools` | `settings.permissions.allow` (inside JSON passed to `settings` input) |
| `output_schema` | `--json-schema` flag in `claude_args`; output read from `structured_output` |

### Pattern (used by every composite action)

```yaml
- name: Build claude config
  id: cfg
  shell: bash
  run: |
    settings=$(jq -c -n \
      --argjson t "$MAX_TURNS" \
      '{permissions:{allow:[...],deny:[...]}, maxTurns:$t}')
    echo "settings<<SETTINGS_EOF" >> "$GITHUB_OUTPUT"
    echo "$settings" >> "$GITHUB_OUTPUT"
    echo "SETTINGS_EOF" >> "$GITHUB_OUTPUT"

- uses: anthropics/claude-code-action@v1
  with:
    settings: ${{ steps.cfg.outputs.settings }}
    claude_args: "--json-schema ${{ steps.cfg.outputs.schema }}"
```

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
