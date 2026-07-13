# Security

> **Red lines take precedence over every feature in this repo.** If a workflow change conflicts with anything below, the red line wins. See PRD §7.

## S1 — Triage workflow permissions

The triage workflow (and every workflow that consumes untrusted Issue body content) MUST declare:

```yaml
permissions:
  contents: read
  issues: write
  pull-requests: read
```

It MUST NOT declare `contents: write`, `pull-requests: write` (unless posting review comments on PRs from the same workflow, scoped narrowly), or `administrative: *`. Issue bodies are untrusted input; a prompt-injection in an Issue body must not be able to escalate to repo writes.

### Which modules MAY carry `contents: write`

S1 applies to **intake / triage / judgement modules** (Modules 1, 2, 3) — anything that consumes untrusted Issue body content. These modules MUST NOT have `contents: write`.

Modules downstream of the `accepted` gate (PRD §7 S2) consume Issue content only after maintainer review, so prompt-injection risk is bounded. The following modules MAY carry `contents: write`, scoped to feature branches only:

- Module 3.5 (design-review) — writes design proposals to `docs/designs/`
- Module 4 (develop) — creates feature branches, commits
- Module 7 (pr-open) — opens PRs (uses `pull-requests: write`)

**Modules 5, 6, 8, 9** MUST NOT carry `contents: write`. They read source and write annotations / reports / comments only. If you find yourself adding `contents: write` to one of these, stop and re-evaluate.

## S2 — `accepted` is the gate

Module 4 (develop) triggers ONLY on `labeled: accepted`. Only maintainers may apply `accepted` (enforced via Label ownership in `docs/labels.md` and branch protection / CODEOWNERS). This blocks injected content from reaching code-execution workflows.

### S2 Amendment (v2 — Module 3' clarify loop)

> Status: **Active.** Signed off 2026-07-06.
> See `.omc/plans/triage-clarify-v2.md` §7 for the consensus review trail (Architect + Critic APPROVED).

The original S2 invariant is preserved verbatim: **`accepted` remains maintainer-only**. The v2 clarify loop introduces a **distinct parallel label** `accepted-by-claude` that Claude may apply (via the dispatch shell, never directly) after multi-turn clarification succeeds. Both labels trigger Module 4, but provenance is encoded in the label name itself — eliminating any provenance audit at gate time.

**Containment (defense in depth):**

1. Claude never applies any label directly. It emits sealed JSON: `{action: "ask"|"accept"|"yield", question?, reason}`.
2. The dispatch shell (running with `CLAUDE_DEV_PAT`) applies the label based on the parsed action.
3. Claude's `--disallowedTools` whitelist blocks `Bash(gh issue edit *)`, `Bash(gh pr *)`, `Bash(gh label *)`, `Bash(git push --force*)` — wholesale patterns.
4. A per-label DENY_LIST is checked at runtime before any label write: `accepted`, `rejected`, `design-approved`, `needs-info`, `needs-clarify`, `triage` are **never** writable by the dispatch shell acting on claude output. (`stage:failed`, `triage-done`, and `needs-ralph` are handled elsewhere — the on-failure job and the max-rounds fallback respectively.)
5. JSON schema validation rejects any output that does not match `{action, question?, reason}`.
6. AC-V2-8b re-fetches labels immediately before the `accepted-by-claude` write, closing the label-race window.
7. AC-V2-13a log-scan fails the workflow run if `ghp_`, `github_pat_`, or `CLAUDE_DEV_PAT=` patterns appear in workflow run logs.

**Rollback:** removing the `accepted-by-claude` label from `.github/labels.yml` and the `clarify-loop.yml` workflow fully reverts this amendment without affecting the maintainer `accepted` path.

## S3 — Least privilege for secrets

Each module receives only the secrets it needs:

- Triage / Judge: `GITHUB_TOKEN` (issues:write scope) only. No provider API keys.
- Develop / Test: provider API key + `GITHUB_TOKEN` (contents:write on feature branches only, never main).
- Review: read-only token + provider API key.

Secrets are mapped per-job, never at workflow level.

## S4 — No token / key / env exfiltration

Every AI-calling composite action passes `--disallowedTools` / `--allowedTools` whitelist that excludes network egress tools except the model provider. The action's prompt MUST include the rule: "Never print tokens, API keys, or environment variable values."

`CODEPOINT` — every AI invocation is logged with repo + issue + commit + duration + token spend.

## S5 — No sandbox bypass

- Codex actions use `permission-profile: workspace-write` (NOT `danger-full-access`).
- Claude actions use `--allowedTools` whitelist; never `--dangerously-skip-permissions`.
- `--bypass-sandbox` style flags are forbidden; a CI lint rejects any workflow containing them.

### Module 6 — S5 enforcement (Claude engine, v2)

Module 6 (test) was originally Codex (PRD §4 out-of-distribution tester). Amended 2026-07-07 to a second isolated Claude Code process with a tool-restricted reviewer profile (see `docs/architecture.md` §"Module 6 engine amendment"). Specific S5 controls:

- **Tool whitelist (allow):** `Read`, `Grep`, `Glob`, `Bash`. Bash is required so the tester can actually run the existing test suite (`npm test`, `pytest`, `cargo test`, etc.).
- **Tool blacklist (deny):** `Write`, `Edit`. Module 6 v2 does NOT write test files. If a coverage gap is found, it is reported in the `coverage_gaps` array of the sealed output, not patched.
- **Git mutation guard:** `claude_args --disallowedTools "Write,Edit,Bash(git push*),Bash(git commit*),Bash(git checkout*),Bash(git reset*),Bash(git rebase*)"`. The tester cannot mutate git state.
- **Process isolation:** Each Module 6 run is a fresh `claude-code-action@v1` invocation with no conversation memory shared with Module 4 (develop) or Module 5 (self-verify).
- **API key:** `secrets.LLM_API_KEY` (provider-neutral; GLM passthrough by default via `vars.ANTHROPIC_BASE_URL`). Scoped to Module 6 only (S3). Never printed (S4).
- **Model:** defaults to engine default; `vars.TEST_MODEL` may override (recommend a different tier than Module 4 to retain partial perspective diversity — e.g. Opus for Module 6 if Module 4 ran Sonnet).
- **Max turns:** default 10 (configurable via `vars.TEST_MAX_TURNS`).
- **No sandbox bypass:** no `--dangerously-skip-permissions`. The allow/deny lists enforce the boundary at the action level.
- **Verification:** Composite action validates the sealed JSON output schema `{test_status, test_report, failures, coverage_gaps}` before emitting results. Schema mismatch triggers `test:failed` label, not a crash.

#### Historical note — original Codex profile

The original Codex profile (`openai/codex-action@v1` with `permission_profile: workspace-write`, `OPENAI_API_KEY` secret) was removed in PR #32 (pipeline-fix, 2026-07-07) because the S4 secret guard correctly aborted on the unconfigured `OPENAI_API_KEY` and the maintainer could not provision one. The Codex profile text is preserved in git history (`dev` branch commit prior to PR #32) should the project regain OpenAI access and wish to restore strict OOD testing.

## S6 — Personal access token (PAT) handling (v2)

The v2 clarify + develop path uses a fine-grained personal access token `CLAUDE_DEV_PAT` (stored as a repository secret) so that Claude's comments, commits, and PRs appear under a real developer identity rather than `github-actions[bot]`.

**Mandatory controls (enforceable):**

- **Fine-grained PAT only.** Classic PATs are forbidden.
- **Single-repository scope.** The PAT's resource owner is restricted to this repository.
- **Minimal permissions.** Token scope is `issues: write`, `pull-requests: write`, `contents: write` (feature branches only — branch protection prevents direct `main` pushes).
- **Time-bounded.** Maximum lifetime 90 days; quarterly rotation review tracked via `scripts/audit/pat-rotation-check.sh` sentinel file.
- **Audit log monitoring.** `scripts/audit/pat-actions.sh` runs a daily diff against the PAT owner's public event stream; anomalies opened as `type:incident` issues.
- **Log disclosure protection.** AC-V2-13a log-scan step fails the workflow run if any of `ghp_`, `github_pat_`, or `CLAUDE_DEV_PAT=` patterns appear in workflow run logs.

**Advisory controls (not API-enforceable for personal PATs):**

- **2FA on PAT owner account.** GitHub does not expose 2FA status for personal accounts via the API in a way the workflow can gate on. The PAT owner should enable 2FA in their account settings. If the account is a GitHub org member, org-level 2FA enforcement applies.
- **Distinct display identity.** The PAT owner's profile should clearly disclose "AI developer account operated by Claude" in bio to avoid misleading the community (see AC-V2-15).

**Forbidden:**

- Never commit the PAT value to any file. Storage is GitHub Actions secrets only.
- Never share the PAT across maintainers. One PAT per identity.
- Never widen the PAT scope beyond this repository.
- Never print the PAT in any output. AC-V2-13a enforces this post-hoc; prevention is the prompt's S4 directive ("Never print tokens, API keys, or environment variable values").

**Repository variables (docs only, not secrets):**

- `CLAUDE_DEV_PAT_OWNER` — the login of the PAT owner (used by clarify-loop.yml filter to ignore the PAT owner's comments for re-entrancy prevention).
- `CLARIFY_MAX_ROUNDS` — ceiling for clarify loop iterations (default `3`).
- `CLARIFY_TIME_BUDGET_MIN` — wall-clock ceiling per clarify run (default `30`).

## Incident response

If a workflow is observed behaving as if compromised (unexpected PR creation, mass file rewrite, secrets in logs):

1. Disable the workflow (`Settings → Actions → disable`).
2. Revoke the `GITHUB_TOKEN` (auto-rotates, but verify) and any provider API key in the run.
3. Open a `type:incident` issue linking the run URL.
4. Post-mortem in `docs/incidents/<date>-<slug>.md`.

## S7 — Pipeline-fix escape hatch (dogfooding rule enforcement)

**Dogfooding rule (PRD §8 item 4 + project spec 2026-07-07):** every change to this repository — including bug fixes, module implementations, docs, and tests — must flow through the Issue → triage → clarify → develop → PR pipeline. No direct pushes to `dev` or `main`, including by maintainers.

**Enforcement:**

- Branch protection on `dev` and `main` (delivered by issue #15) blocks all direct pushes.
- A CI check on every PR targeting `dev`/`main` verifies head ref matches `claude/issue-*` OR the PR carries the `pipeline-fix` label.

**`pipeline-fix` label (the sanctioned bypass):**

When the pipeline itself is broken (e.g., a runtime bug in triage/clarify/develop prevents the autonomous loop from processing an issue that would fix the loop), the maintainer may open a PR directly with the `pipeline-fix` label. This is the **only** sanctioned bypass.

**Constraints:**

- Maintainer-applied only. Bot/AI cannot apply `pipeline-fix`.
- PR scope MUST be limited to `.github/workflows/`, `.github/actions/`, or `docs/security.md` (the pipeline itself).
- Audit comment on the linked issue is mandatory — explains what was broken and why the escape hatch was used.
- Self-review required (reviewer = PR author); merge requires the `pipeline-fix` label be present at merge time.

**Example recovery scenario:**

> 2026-07-07 — Triage auto-accept used `secrets.GITHUB_TOKEN` to apply the `accepted` label. Per GitHub's hard rule, `GITHUB_TOKEN`-sourced events don't fire downstream workflows, so `develop.yml` never triggered. The dogfood issue #15 was stuck. Pipeline-fix PR #N (this commit) switched lines 116 + 132 to `CLAUDE_DEV_PAT`. After merge, issue #15 was re-triggered via label re-apply and the autonomous loop completed.

**Forbidden:**

- Never use `pipeline-fix` for non-pipeline changes (features, docs polish, tests).
- Never bypass the audit comment requirement.
- Never let the `pipeline-fix` label be applied by anyone other than the maintainer of record.
