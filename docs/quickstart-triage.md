# Quickstart: Issue → Claude → Reply/Work

This is the first end-to-end runnable flow in the repo. When a new Issue is opened, claude analyzes it and posts a comment. Optionally, claude can also auto-accept the issue into the development pipeline.

## Quick setup (recommended)

The interactive wizard at [`scripts/setup/wizard.mjs`](../scripts/setup/wizard.mjs) automates the bootstrap steps below (API key secret, DeepSeek passthrough vars, labels, CODEOWNERS, branch protection):

```bash
cd scripts/setup
npm install
node wizard.mjs --dry-run    # preview every step
node wizard.mjs              # execute with per-step confirm
```

The manual sections that follow describe the same steps for reference, troubleshooting, and environments where running an interactive CLI is not desirable.

## What it does

1. Trigger: `issues.opened` (also `workflow_dispatch` for manual testing).
2. Calls `./.github/actions/triage` which dispatches to `anthropics/claude-code-action@v1`.
3. Claude reads `CLAUDE.md` + only the directories named in the issue body (PRD §5 context budget) and outputs structured JSON:
   ```json
   { "decision": "reply"|"work",
     "comment_body": "...",
     "suggested_labels": [...],
     "confidence": 0.0–1.0,
     "workload_class": "trivial"|"standard"|"complex" }
   ```
4. The workflow posts `comment_body` as a comment on the issue.
5. The workflow applies the `triage` label.
6. M8 routing (per `workload_class`):
   - `decision == "work"` + `workload_class ∈ {trivial, standard}` → applies `accepted-by-claude` label (Claude self-acceptance, S2 amendment — Module 4 develop-gate picks this up).
   - `decision == "work"` + `workload_class == complex` → applies `needs-clarify` label (Module 3' clarify loop engages for deeper scoping).
   - `decision == "reply"` → comment-only, end of pipeline.

## One-time setup

### 1. Add the API key as a secret

GitHub → your repo → **Settings → Secrets and variables → Actions → New repository secret**

| Name | Value |
|---|---|
| `DEEPSEEK_API_KEY` | Your DeepSeek API key (get one at https://platform.deepseek.com) |

> **Don't paste the key into the repo, commits, or PR descriptions.** S4: AI must never print tokens or API keys.

### 2. Configure DeepSeek passthrough

Set these **repo variables** (Settings → Secrets and variables → Actions → Variables tab):

| Name | Value |
|---|---|
| `ANTHROPIC_BASE_URL` | `https://api.deepseek.com/anthropic` |
| `TRIAGE_MODEL` | `deepseek-v4-pro` |

The `ANTHROPIC_BASE_URL` redirects claude-code-action's Anthropic SDK to DeepSeek's Anthropic-compatible endpoint. `DEEPSEEK_API_KEY` is passed as the bearer token.

### 3. Routing behavior (no toggle needed)

There is no `AUTO_ACCEPT_ENABLED` repo var anymore (removed in M8). Routing is automatic per issue:

| `workload_class` | Label applied | Next step |
|---|---|---|
| `trivial` / `standard` | `accepted-by-claude` | Module 4 develop-gate triggers |
| `complex` | `needs-clarify` | Module 3' clarify loop engages |
| (empty/unset) | `needs-clarify` | Safe default — clarify loop scopes the work |

⚠️ **PRD §7 S2 amendment (M8)**: `accepted-by-claude` is now applied by `triage-issue.yml` itself for low-risk (`trivial`/`standard`) classes. Maintainers can override at any time with `rejected`.

## Testing

### Manual trigger (no GitHub event needed)

1. Push the workflow to your default branch.
2. GitHub → Actions → "triage-issue" → Run workflow → pass an existing issue number.
3. Watch the run logs; check the issue for a new comment.

### Real trigger

Open a test issue with realistic content. Within ~1-2 minutes you should see:

- A comment from `github-actions[bot]` containing claude's analysis.
- The `triage` label applied.
- (If `decision=work` and `workload_class ∈ {trivial, standard}`) The `accepted-by-claude` label applied — Module 4 engage immediately.
- (If `workload_class == complex`) The `needs-clarify` label applied — Module 3' clarify loop will ask questions.

## Troubleshooting

### "No engine output" in logs

claude-code-action's output names may have changed across versions. Check the [action's documentation](https://github.com/anthropics/claude-code-action) for the version pinned in `.github/actions/triage/action.yml`. If the output name changed from `response` to something else, update `CLAUDE_RESPONSE` in `extract.sh` and the step output reference.

### API key errors

If you see 401/403 from `api.deepseek.com`:

- Verify `DEEPSEEK_API_KEY` is the DeepSeek key, not an Anthropic key.
- Verify the key has not expired and has credit on the DeepSeek dashboard.
- Test the key locally: `curl -H "Authorization: Bearer $DEEPSEEK_API_KEY" https://api.deepseek.com/anthropic/v1/messages -d '{"model":"deepseek-v4-pro","max_tokens":10,"messages":[{"role":"user","content":"hi"}]}'`

### claude-code-action rejects the base URL

Some versions of claude-code-action hardcode the Anthropic endpoint and ignore `ANTHROPIC_BASE_URL`. If the action log shows requests to `api.anthropic.com` despite the env var being set, either:

- Pin a newer version of claude-code-action that respects `ANTHROPIC_BASE_URL`, or
- Switch to engine=codex in the workflow call (uses `openai/codex-action`), or
- Replace the claude branch in `.github/actions/triage/action.yml` with a direct `curl` to the DeepSeek endpoint. This drops the claude-code CLI integration but removes the dependency entirely.

### JSON parse failures

If the engine returns prose-wrapped JSON (e.g. `Here is my analysis: {...}`), `extract.sh` will fail loudly. The `output_schema` enforcement on the action call should prevent this — if it recurs, the engine may be ignoring the schema. File an issue with the raw output attached.

### `accepted-by-claude` label not being applied (M8 routing)

Check, in order:

1. The workflow log step "Route by workload_class (M8)" was reached (decision was `work`).
2. The triage composite emitted `workload_class` (check `steps.triage.outputs.workload_class` in the log).
3. `workload_class` was `trivial` or `standard`. Complex or empty routes to `needs-clarify` instead.
4. The `accepted-by-claude` label exists in the repo's label list.

## Disabling

- **Disable the workflow**: GitHub → Actions → "triage-issue" → ⋯ → Disable workflow. Existing issues are unaffected.
- **Force every `work` decision to clarify (bypass M8 auto-accept)**: not exposed as a repo var. Edit `.github/workflows/triage-issue.yml` to comment out the `trivial|standard)` case.

## Two-tier flow with local ralph (deep analysis)

Cloud first-pass is fast but shallow. For contested or work-like issues, the cloud workflow applies the `needs-ralph` label, signalling your local cron to dispatch a deeper ralph analysis.

### How the two tiers connect

```
issue opened
  ↓ (cloud)
triage-issue.yml — single LLM call, emits {decision, confidence}
  ↓
decision==work OR confidence<TRIAGE_RALPH_THRESHOLD ?
  YES → apply needs-ralph + post "⏳ queued" comment
  NO  → comment-only flow (existing path)
  ↓ (local cron)
poll.sh detects needs-ralph → dispatches handle-triage.sh
  ↓
handle-triage.sh: claude -p with Skill("oh-my-claudecode:ralph")
  ↓
ralph writes .omc/state/triage-issue-N.json (10-field schema)
  ↓
wrapper validates JSON, posts formatted comment, applies triage-done + suggested non-state labels
  ↓
maintainer reads ralph analysis, decides accept/reject
```

### Configuration knobs

| Setting | Type | Default | Effect |
|---|---|---|---|
| `TRIAGE_RALPH_THRESHOLD` | repo variable | `0.7` | Confidence below this triggers ralph even if decision is `work` |
| `MAX_TURN_MINUTES` | local config.sh | `15` | Wall-clock cap for the local claude call |
| `CLAUDE_BIN` | local config.sh | `claude` | Override if your claude CLI is elsewhere |

### Local setup (one-time)

1. Install the local poll stack per [`scripts/local/README.md`](../scripts/local/README.md).
2. Make sure `claude` and `omc` are on `$PATH` and accessible to cron.
3. Configure `~/.config/githubautodev/config.sh` with `GITHUB_REPO`, `GITHUB_TOKEN`.
4. Install cron entry (every 2 minutes recommended).

### Reading ralph's output

After ralph finishes, the issue gets a formatted comment with:

- **Decision** (bug/feature/duplicate/out-of-scope/needs-info) and **confidence**
- **Size estimate** with rationale
- **Summary** + **rationale** (cites issue body or codebase paths)
- **Draft acceptance criteria** (only for bug/feature decisions)
- **Risks** list
- **Related issues** (only for duplicate decisions)
- **Applied suggested labels** (type:* and size:*; never state labels — those stay maintainer-only)
- A "⚠️ Ralph overturns cloud first-pass" preamble when ralph's decision disagrees with the cloud first-pass

The full structured JSON is at `.omc/state/triage-issue-N.json` in your local clone (gitignored).

### Race condition: maintainer applies `accepted` during ralph's window

If you apply `accepted` while ralph is still running (or before `poll.sh` picks up `needs-ralph`), `poll.sh` will:

- See both labels on the issue.
- Dispatch to `handle.sh` (develop path) — `accepted` wins (AC-P4).
- Remove `needs-ralph` and mark the issue seen so `handle-triage.sh` does NOT subsequently run.

No ralph analysis will be posted in that case. This is by design — `accepted` short-circuits the deep-analysis path.

### S2 enforcement

`handle-triage.sh` enforces S2 (only maintainers apply `accepted`) at three layers:

1. The wrapper itself never writes `--add-label accepted` (verified by an AC-H13 defensive self-grep at startup).
2. Ralph runs with `--disallowedTools 'Bash(gh issue edit *)'` — even if prompt-injected, the binary refuses.
3. Suggested labels from ralph pass through an allow-list with a hard-coded deny-list: `accepted`, `rejected`, `stage:failed`, `design-approved`, `needs-info`, `triage`, `triage-done`, `needs-ralph`. Ralph's `suggested_labels` array can only contain non-state labels.

### Recommended PAT scope for the local stack

Use a fine-grained PAT with:

- `issues: write` (for posting comments and applying `triage-done` / non-state labels)
- `contents: read` (for reading CLAUDE.md / repo state)
- `metadata: read`

If your GitHub plan supports label restrictions, consider explicitly denying `accepted`/`rejected` application for this token. Otherwise, the wrapper's defensive grep is your safety net.

### Troubleshooting the ralph path

| Symptom | Cause | Fix |
|---|---|---|
| `needs-ralph` stays on issue > 15 min | Local cron not running, or `handle-triage.sh` failed | Check `/tmp/githubautodev-poll.log`; remove the issue from `~/.local/state/githubautodev/triage-failed.txt` to retry |
| Ralph analysis comment missing | claude binary errored, or schema validation failed | Check `triage-failed.txt`; inspect `.omc/state/triage-issue-N.json` if it exists; re-queue by removing/re-adding `needs-ralph` |
| `stage:failed` on issue | Ralph crashed, schema validation failed, or wall-clock timeout exceeded | Same as above; ralph is non-destructive — re-queue is always safe |
| `accepted` applied during ralph run | Maintainer raced ralph (AC-P4 path) | Expected; `accepted` wins, ralph skipped |
| `Ralph overturns` preamble appears frequently | Cloud first-pass and ralph consistently disagree | Calibrate `TRIAGE_RALPH_THRESHOLD` upward (so cloud lets more through without ralph); or review cloud prompt for bias |

## Related

- [`docs/composite-action-spec.md`](composite-action-spec.md) — full interface spec for the triage action.
- [`docs/labels.md`](labels.md) — Label state machine (where `triage`, `needs-ralph`, and `triage-done` live).
- [`docs/security.md`](security.md) — S1–S5 red lines this workflow enforces.
- [`docs/quickstart-clarify.md`](quickstart-clarify.md) — v2 clarify loop setup (the work path now flows through Module 3').
- [`scripts/local/README.md`](../scripts/local/README.md) — local poll + handle stack setup.
- [`.github/workflows/triage-issue.yml`](../.github/workflows/triage-issue.yml) — the cloud workflow.
