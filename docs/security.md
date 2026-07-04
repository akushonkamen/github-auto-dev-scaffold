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

## Incident response

If a workflow is observed behaving as if compromised (unexpected PR creation, mass file rewrite, secrets in logs):

1. Disable the workflow (`Settings → Actions → disable`).
2. Revoke the `GITHUB_TOKEN` (auto-rotates, but verify) and any provider API key in the run.
3. Open a `type:incident` issue linking the run URL.
4. Post-mortem in `docs/incidents/<date>-<slug>.md`.
