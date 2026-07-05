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
| `ZHIPU_API_KEY` | Your Zhipu AI API key (get one at https://open.bigmodel.cn) |

> **Don't paste the key into the repo, commits, or PR descriptions.** S4: AI must never print tokens or API keys.

### 2. (Optional) Configure GLM 5.2 passthrough

If you want claude-code-action to route through Zhipu AI's Anthropic-compatible endpoint instead of Anthropic's real API, set these **repo variables** (Settings → Secrets and variables → Actions → Variables tab):

| Name | Value |
|---|---|
| `ANTHROPIC_BASE_URL` | `https://open.bigmodel.cn/api/anthropic` |
| `TRIAGE_MODEL` | (optional) e.g. `claude-sonnet-4-6` — Zhipu's compat layer accepts Anthropic model names |

Leave both unset to use Anthropic directly (in that case `ZHIPU_API_KEY` should be a real Anthropic key, rename it to `ANTHROPIC_API_KEY` and update the workflow).

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

If using GLM passthrough and you see 401/403 from `open.bigmodel.cn`:

- Verify `ZHIPU_API_KEY` is the Zhipu key, not an Anthropic key.
- Verify the key has not expired and has credit on the Zhipu dashboard.
- Test the key locally: `curl -H "Authorization: Bearer $ZHIPU_API_KEY" https://open.bigmodel.cn/api/anthropic/v1/messages -d '{"model":"claude-sonnet-4-6","max_tokens":10,"messages":[{"role":"user","content":"hi"}]}'`

### claude-code-action rejects the base URL

Some versions of claude-code-action hardcode the Anthropic endpoint and ignore `ANTHROPIC_BASE_URL`. If the action log shows requests to `api.anthropic.com` despite the env var being set, either:

- Pin a newer version of claude-code-action that respects `ANTHROPIC_BASE_URL`, or
- Switch to engine=codex in the workflow call (uses `openai/codex-action`), or
- Replace the claude branch in `.github/actions/triage/action.yml` with a direct `curl` to the Zhipu endpoint. This drops the claude-code CLI integration but removes the dependency entirely.

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

## Related

- [`docs/composite-action-spec.md`](composite-action-spec.md) — full interface spec for the triage action.
- [`docs/labels.md`](labels.md) — Label state machine (where `triage` and `accepted` live).
- [`docs/security.md`](security.md) — S1–S5 red lines this workflow enforces.
- [`.github/workflows/triage-issue.yml`](../.github/workflows/triage-issue.yml) — the actual workflow.
