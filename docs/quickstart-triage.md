# Quickstart: Issue → Claude → Reply/Work

This is the first end-to-end runnable flow in the repo. When a new Issue is opened, claude analyzes it and posts a comment. Optionally, claude can also auto-accept the issue into the development pipeline.

## What it does

1. Trigger: `issues.opened` (also `workflow_dispatch` for manual testing).
2. Calls `./.github/actions/triage` which dispatches to `anthropics/claude-code-action@v1`.
3. Claude reads `CLAUDE.md` + only the directories named in the issue body (PRD §5 context budget) and outputs structured JSON:
   ```json
   { "decision": "reply"|"work",
     "comment_body": "...",
     "suggested_labels": [...],
     "confidence": 0.0–1.0 }
   ```
4. The workflow posts `comment_body` as a comment on the issue.
5. The workflow applies the `triage` label.
6. If `decision == "work"` **and** repo variable `AUTO_ACCEPT_ENABLED == "true"`: applies `accepted` label (which downstream Module 4 — develop — listens for).
7. Otherwise: claude's recommendation is in the comment; maintainer decides.

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

### 3. (Optional) Enable auto-accept

By default, claude only comments. To let it auto-apply the `accepted` label when it decides `work`, add a third repo variable:

| Name | Value |
|---|---|
| `AUTO_ACCEPT_ENABLED` | `true` |

⚠️ **PRD §7 S2**: enabling this means any issue can be promoted to code-generation without maintainer review. Only enable on private repos or repos with trusted submitters.

## Testing

### Manual trigger (no GitHub event needed)

1. Push the workflow to your default branch.
2. GitHub → Actions → "triage-issue" → Run workflow → pass an existing issue number.
3. Watch the run logs; check the issue for a new comment.

### Real trigger

Open a test issue with realistic content. Within ~1-2 minutes you should see:

- A comment from `github-actions[bot]` containing claude's analysis.
- The `triage` label applied.
- (If `AUTO_ACCEPT_ENABLED=true` and claude said `work`) The `accepted` label applied.

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

### `accepted` label not being applied

Check, in order:

1. The workflow log step "Auto-accept (S2 opt-in)" was reached (decision was `work`).
2. Repo variable `AUTO_ACCEPT_ENABLED` is set to exactly the string `true` (not "True", "yes", "1").
3. The `accepted` label exists in `.github/labels.yml` and was synced to the repo.

## Disabling

Two kill switches:

- **Disable the workflow**: GitHub → Actions → "triage-issue" → ⋯ → Disable workflow. Existing issues are unaffected.
- **Disable just auto-accept while keeping triage comments**: delete the `AUTO_ACCEPT_ENABLED` repo variable.

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
