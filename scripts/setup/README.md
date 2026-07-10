# Setup Wizard

Interactive CLI that bootstraps a target repo for the GithubAutoDev Issue → PR
pipeline. Walks the user through 12 steps (preflight → smoke-test) with per-step
confirm prompts, dry-run preview, and resumable state.

> **Status:** v0.1 — covers secrets, repo vars, labels sync, CODEOWNERS
> generation, branch-protection preview, and optional Notion mirror. Automated
> pipeline file deployment is intentionally out of scope (Step 5 surfaces a
> manual checklist — file copy should go through the target repo's own
> Issue → PR pipeline per S7 dogfooding rule).

## Quickstart

```bash
cd scripts/setup
npm install
node wizard.mjs --dry-run       # preview only
node wizard.mjs                 # interactive, executes after each confirm
```

Re-resume from a step:

```bash
node wizard.mjs --from-step=4
```

Force a clean rerun:

```bash
node wizard.mjs --no-state
```

## What it configures

| Step | Action |
|---|---|
| 00 | Pre-flight: gh auth, node ≥20, git installed |
| 01 | Target repo (owner/name) — validated via `gh repo view` |
| 02 | Base branch (S3: never `main`/`master`) |
| 03 | LLM provider (DeepSeek passthrough / Anthropic / custom) + health probe |
| 04 | `CLAUDE_DEV_PAT` — fine-grained only (S6), validated against `/user` |
| 05 | Pipeline files deployment checklist (manual) |
| 06 | 24 repo vars (engine core, budgets, retry, repo meta) |
| 07 | Labels sync — diff `.github/labels.yml` against remote |
| 08 | `.github/CODEOWNERS` generation (validates team slugs via gh api) |
| 09 | Branch protection preview (CI pass, ≥1 review, enforce_admins) |
| 10 | Optional: Notion Issue mirror |
| 11 | Optional: smoke-test issue + triage workflow watch |

## Security posture

- **Secrets never touch disk.** API keys / PAT live in process memory only and
  are piped straight to `gh secret set --body`. `.wizard-state.json` records
  step completion + non-secret metadata only.
- **PAT enforcement (S6).** Validator rejects classic `ghp_*` tokens; only
  `github_pat_*` (fine-grained) accepted.
- **Least-privilege probes.** PAT validated against `GET /user`; LLM provider
  against `/v1/messages` with a 1-token request; Notion via `GET /v1/databases/:id`.
- **Dry-run everywhere.** `--dry-run` previews every command without execution.
- **execFile, not exec.** No shell spawning; user-supplied repo/branch names
  are shell-quoted via `shellQuote()` to prevent injection.
- **Idempotent writes.** All `gh variable set` / `gh label create --force`
  operations are safe to re-run.
- **`.wizard-state.json` is gitignored** — `ensureGitignored()` adds it on
  first run if missing.

## Tests

```bash
npm test
```

Unit tests cover:
- `lib/validators.mjs` — input boundary checks (repo, branch, PAT, URL, model, team slug, mask)
- `lib/steps/07-labels.mjs::parseLabelsYml` — YAML-ish label parsing (no external dep)
- `lib/steps/08-codeowners.mjs::renderCodeowners` — CODEOWNERS template generation
- `lib/shell.mjs` — dry-run behaviour, mask redaction, `parseRemoteUrl` for ssh/https remotes

## Layout

```
scripts/setup/
├── wizard.mjs                # entry point — orchestrates 12 steps
├── package.json              # "type":"module", node ≥20, @inquirer/prompts
├── lib/
│   ├── shell.mjs             # execFile-based gh/git helpers (dry-run aware)
│   ├── validators.mjs        # pure sync input validators
│   ├── preview.mjs           # ANSI-coloured output helpers
│   ├── state.mjs             # .wizard-state.json persistence
│   └── steps/
│       ├── 00-preflight.mjs … 11-smoke-test.mjs
└── test/
    ├── validators.test.mjs
    ├── labels-parser.test.mjs
    ├── codeowners-gen.test.mjs
    └── shell-mock.test.mjs
```

## Troubleshooting

- **`gh not authenticated`** → run `gh auth login --web` then retry.
- **PAT probe returns 401** → token lacks `metadata:read`; recreate with all
  required scopes (see Step 4 in-prompt help).
- **LLM probe returns HTTP 401/404** → wrong base URL or model id; verify with
  `curl $BASE_URL/v1/messages` outside the wizard.
- **Branch protection PUT 422** → target repo lacks any status check named `ci`;
  adjust contexts in `09-branch-protection.mjs` or create the workflow first.
- **`Cannot find module '@inquirer/prompts'`** → run `npm install` inside
  `scripts/setup/`.

## Out of scope (v0.1)

- Automated file deployment to remote target repos (Step 5 prints a manual
  checklist — keeps blast radius small and respects the target repo's own
  Issue → PR pipeline).
- Ralph / poll.sh configuration.
- Module 3.5 design review setup (default disabled).
- Web/GUI version.

## See also

- [docs/quickstart-triage.md](../../docs/quickstart-triage.md) — manual bootstrap for the triage flow (what the wizard automates, with troubleshooting detail)
- [docs/quickstart-clarify.md](../../docs/quickstart-clarify.md) — v2 clarify loop setup (PAT, repo vars, fixture walkthrough)
- [docs/security.md](../../docs/security.md) — S1–S7 red lines the wizard enforces
- [CLAUDE.md](../../CLAUDE.md) — AI agent architecture map for this repo

