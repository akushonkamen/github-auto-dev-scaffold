# Quickstart: v2 Clarify Loop (Module 3')

The clarify loop is the **multi-turn clarification engine** that sits between
cloud triage (Module 2) and code generation (Module 4). When cloud triage flags
an issue as low-confidence `work`, the clarify loop asks the author follow-up
questions before committing to development.

## What it does

1. **Trigger**: `issues.labeled` with `needs-clarify` OR `issue_comment.created`
   by the issue author (filtered to exclude the PAT owner's own comments).
2. **Preflight** (defense-in-depth, runs before every clarify round):
   - Bail out if the comment already contains a sentinel marker
     `<!-- claude-clarify-round-N -->` (re-entrancy guard, AC-V2-3c).
   - Check for maintainer override labels (`accepted`, `rejected`, `force-manual`)
     — halt with a yield comment if any are present.
   - Cross-check the `clarify-r-N` label against the hidden comment
     `<!-- CLARIFY_STATE round=N -->` (AC-V2-13 state integrity).
   - Check if `round > CLARIFY_MAX_ROUNDS` (default 3) — if exhausted,
     emit `needs-ralph` for deep analysis (the ONLY path that emits `needs-ralph` in v2).
3. **Clarify job**: calls `./.github/actions/clarify` (composite wrapping
   `anthropics/claude-code-action@v1`) with sealed JSON output:
   ```json
   { "action": "ask"|"accept"|"yield", "question": "string?", "reason": "string" }
   ```
4. **Dispatch shell** (workflow, NOT claude) acts on the parsed output:
   - `ask` → post question comment + advance `clarify-r-N` label
   - `accept` → apply `accepted-by-claude` label (triggers Module 4 develop)
   - `yield` → apply `yielded` label + nudging comment to maintainer
5. **Log-scan** (AC-V2-13a): fails the run if any token patterns leak into output.

### Decision vocabulary map

| Cloud (Module 2) | Clarify (Module 3') | Label emitted |
|---|---|---|
| `reply` | (skips clarify entirely) | — |
| `work` (low conf.) | `ask` | `clarify-r-N` |
| `work` (low conf.) | `accept` | `accepted-by-claude` |
| `work` (low conf.) | `yield` | `yielded` |
| `work` (N rounds exhausted) | max-rounds fallback | `needs-ralph` |

## One-time setup

### 1. Create a fine-grained PAT

The clarify loop and develop workflow need a personal access token so that
Claude's actions appear under a real developer identity.

1. GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token
2. **Resource owner**: your personal account (or a dedicated bot account).
3. **Repository access**: "Only select repositories" → choose this repo.
4. **Permissions**:
   - `contents: read and write` (feature branches only — branch protection guards `main`)
   - `issues: read and write`
   - `pull-requests: read and write`
   - `metadata: read`
5. **Expiration**: 90 days (mandatory — rotation tracked via `scripts/audit/pat-rotation-check.sh`).

Save the generated token — you'll need it in the next step.

### 2. Add secrets and variables

GitHub → your repo → **Settings → Secrets and variables → Actions**

**Secrets tab** (New repository secret):

| Name | Value |
|---|---|
| `CLAUDE_DEV_PAT` | The fine-grained PAT from step 1 |
| `LLM_API_KEY` | Your Zhipu GLM API key (https://open.bigmodel.cn) |

**Variables tab** (New repository variable):

| Name | Default | Purpose |
|---|---|---|
| `CLAUDE_DEV_PAT_OWNER` | (required) | PAT owner's GitHub login — used to filter out bot comments (AC-V2-3b) |
| `CLARIFY_MAX_ROUNDS` | `3` | How many clarification rounds before falling back to `needs-ralph` |
| `CLARIFY_TIME_BUDGET_MIN` | `30` | Per-issue wall-clock ceiling (minutes); clarify loop exits if exceeded |
| `ANTHROPIC_BASE_URL` | `https://open.bigmodel.cn/api/anthropic` | Zhipu GLM Anthropic-compatible endpoint |
| `TRIAGE_MODEL` | `glm-5.2` | Model override for triage/clarify LLM calls |
| `DEVELOP_MODEL` | `glm-5.2` | Model override for develop LLM calls |

> **S6**: Never commit `CLAUDE_DEV_PAT` to any file. Never share it across maintainers.
> The PAT's permissible scope is this repository only.

### 3. Configure GLM passthrough

The workflows use Zhipu GLM's Anthropic-compatible endpoint (`https://open.bigmodel.cn/api/anthropic`).
`ANTHROPIC_BASE_URL` redirects claude-code-action's Anthropic SDK to GLM;
`LLM_API_KEY` is passed as the bearer token. Model name must be `glm-5.2`.

## How the full v2 pipeline connects

```
issue opened
  ↓ (cloud, Module 2)
triage-issue.yml — single LLM call → {decision, comment_body, workload_class, ...}
  ↓
decision==reply → comment-only (done)
decision==work + workload_class ∈ {trivial, standard} → accepted-by-claude (M8 S2 amendment) → Module 4 develop-gate
decision==work + workload_class == complex → needs-clarify
  ↓ (cloud, Module 3')
clarify-loop.yml — multi-turn with issue author
  ├─ ask → clarify-r-N, wait for author reply
  ├─ accept → accepted-by-claude → Module 4 develop-gate
  ├─ yield → yielded, maintainer decides
  └─ max-rounds → needs-ralph (v1 deep-analysis path only)
  ↓ (cloud, Module 4)
develop.yml — triggered by accepted OR accepted-by-claude
  → creates feature branch claude/issue-N-<slug>
  → generates code via Claude
  → pushes branch + opens PR
```

### v1/v2 coexistence

The v1 local poller (`scripts/local/poll.sh`) is **opt-in** (default:
`POLL_ENABLED=false`). When enabled, it only polls `accepted` and `needs-ralph`
— never `needs-clarify`. The v2 cloud pipeline is authoritative for the
clarify loop path. See `scripts/test/coexistence-v1v2.sh` for the isolation test.

## Testing

### Unit tests (local, no GitHub needed)

```bash
# Parser: verify AC-V2-13 cross-check logic (5 scenarios)
bash scripts/test/parse-clarify-state.sh

# Language detection: verify CJK ratio heuristic (8 scenarios)
bash scripts/test/lang-detect.sh

# Round counter: verify exhaustion boundary logic (10 scenarios)
bash scripts/test/boundary-round-counter.sh

# Coexistence: verify v1 poll.sh isolation (4 scenarios)
bash scripts/test/coexistence-v1v2.sh
```

### Fixture-based testing (requires live repo)

Fixture issues live in `.github/fixtures/`:

| Fixture | Expected outcome |
|---|---|
| `vague-feature.md` | `clarify-r-1` → `accepted-by-claude` or `yielded` |
| `specific-bug-zh.md` | `accepted-by-claude` (clear Chinese bug report) |
| `specific-bug-en.md` | `accepted-by-claude` (clear English bug report) |
| `hostile-injection.md` | `yielded` (prompt injection detected) |
| `ambiguous-low-conf.md` | `clarify-r-1` or `yielded` |
| `stripped-hidden-comment.md` | `stage:failed` (AC-V2-13 corruption) |
| `malformed-json.md` | `stage:failed` (schema validation) |
| `rapid-fire-comments.md` | concurrency + sentinel marker test |

Submit fixtures via `scripts/test/clarify-e2e.sh` and observe the label sequence.

### End-to-end (real trigger)

1. Push all workflows to the default branch.
2. Open a realistic test issue.
3. Within ~1-2 minutes:
   - `triage` label applied by `triage-issue.yml`.
   - If low-confidence: `needs-clarify` label + claude comment asking a question.
   - Reply to the issue as the issue author — within ~30 seconds, another
     claude comment appears (or `accepted-by-claude` / `yielded` label).
   - If `accepted-by-claude` is applied: `develop.yml` fires, creates a branch
     and opens a PR.

## Troubleshooting

### Clarify loop doesn't fire

Check, in order:

1. The issue has the `needs-clarify` label (applied by `triage-issue.yml`).
2. `GITHUB_TOKEN` has `issues: write` scope — verify workflow permissions.
3. The comment author is the issue author, user type is `User`, and login ≠
   `CLAUDE_DEV_PAT_OWNER` (AC-V2-3b filter).

### Clarify loop fires but exits immediately

This is usually intentional preflight bail-out:

- The comment body contains a sentinel marker `<!-- claude-clarify-round-N -->`
  (AC-V2-3c — claude already handled this round).
- A maintainer override label (`accepted`, `rejected`, `force-manual`) is present.
- `CLARIFY_TIME_BUDGET_MIN` has been exceeded for this issue.

Check the workflow logs for the preflight step — it logs the reason.

### `accepted-by-claude` not being applied

1. Check the clarify job output: did `action` parse as `"accept"`?
2. Verify the dispatch shell's DENY_LIST didn't block it (labels like `accepted`,
   `rejected`, etc. are never writable by the dispatch shell).
3. Verify the AC-V2-8b re-fetch didn't detect a label race.

### `CLARIFY_STATE` corruption (`stage:failed`)

The AC-V2-13 cross-check detected a mismatch between the `clarify-r-N` label
and the hidden `<!-- CLARIFY_STATE round=N -->` comment. This usually means:

- A label was manually removed or applied without updating the hidden comment.
- A GitHub event was lost (race condition).

Recovery: remove both the `clarify-r-N` label and the hidden-comment marker,
then re-apply `needs-clarify` to restart the clarify loop.

### API key errors

If you see 401/403 from `open.bigmodel.cn`:

- Verify `LLM_API_KEY` is correct and has credit.
- Test the key locally:
  ```bash
  curl -H "Authorization: Bearer $LLM_API_KEY" \
    https://open.bigmodel.cn/api/anthropic/v1/messages \
    -d '{"model":"glm-5.2","max_tokens":10,"messages":[{"role":"user","content":"hi"}]}'
  ```

### PAT expired or invalid

If `develop.yml` fails with auth errors on branch push or PR creation:

1. Check the PAT expiration date: `cat docs/security/PAT_ROTATION_DUE.md`
2. Run `bash scripts/audit/pat-rotation-check.sh` — exits non-zero if past due.
3. Generate a new PAT (step 1 above) and update the `CLAUDE_DEV_PAT` secret.
4. Update `docs/security/PAT_ROTATION_DUE.md` to the new expiry date (+90 days).

### Log-scan failures (AC-V2-13a)

If the log-scan step fails, a token pattern (`ghp_`, `github_pat_`,
`CLAUDE_DEV_PAT=`) was detected in claude's output. This should not happen with
the S4 directive and `--disallowedTools` enforcement — if it does, the run has
been blocked. Review the run logs, **do not re-run without fixing the root cause**,
and treat this as a security incident per `docs/security.md#incident-response`.

## Security

The clarify loop enforces all project red lines (S1-S6):

- **S1**: workflow `permissions: contents: read, issues: write` only — no `contents: write`.
- **S2**: `accepted` remains maintainer-only. Claude applies `accepted-by-claude`
  via the dispatch shell, never directly.
- **S3**: secrets are per-job, never workflow-global.
- **S4**: prompt forbids printing tokens. `--disallowedTools` blocks egress.
- **S5**: `--allowedTools` whitelist; `--disallowedTools` wholesale patterns.
- **S6**: fine-grained PAT, 90-day rotation, audit scripts, log-scan enforcement.

See [`docs/security.md`](security.md) for the full operational playbook.

## Related

- [`docs/quickstart-triage.md`](quickstart-triage.md) — Module 2 cloud triage setup (the entry point that feeds into this loop).
- [`docs/labels.md`](labels.md) — Label state machine (where `needs-clarify`, `clarify-r-N`, `accepted-by-claude`, `yielded` live).
- [`docs/architecture.md`](architecture.md) — Full pipeline module map with Module 3' position.
- [`docs/security.md`](security.md) — S1-S6 red lines, PAT handling, incident response.
- [`.github/workflows/clarify-loop.yml`](../.github/workflows/clarify-loop.yml) — The clarify workflow.
- [`.github/workflows/develop.yml`](../.github/workflows/develop.yml) — The downstream develop workflow.
- [`.github/actions/clarify/action.yml`](../.github/actions/clarify/action.yml) — The clarify composite action.
- [`scripts/test/`](../scripts/test/) — Unit + integration test scripts.
