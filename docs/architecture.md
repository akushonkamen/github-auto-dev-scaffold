# Architecture

## Pipeline overview

```
Issue opened
   │
   ▼
[Module 1] Issue Forms (GitHub native)
   │
   ▼ (issues.opened)
[Module 2] Triage ──► label: triage + comment
   │  (Claude cloud first-pass, GLM passthrough)
   │
   ├─ decision=reply                       → comment-only, END
   │
   ├─ decision=work + workload ∈           → label: accepted-by-claude
   │  {trivial, standard} (M8 fast-path)     (S2 amendment — triage may apply
   │                                         for low-risk classes)
   │
   └─ decision=work + workload=complex     → label: needs-clarify
       (or workload unset — safe default)
       │
       ▼ (issues.labeled: needs-clarify OR issue_comment by issue author)
   [Module 3'] Clarify loop (Claude multi-turn)
       │
       ├─ ask    → clarify-r-N (await author reply)
       ├─ accept → accepted-by-claude
       ├─ yield  → yielded (maintainer takeover)
       └─ max-rounds exhausted → needs-ralph
                                  (ONLY emitter after v2; maintainer
                                   dispatches local ralph deep analysis)
   │
   ▼ (workflow_run: clarify-loop completed — M6 wiring)
[Module 4 — develop-gate] preflight
   │  • resolve issue from issue-context artifact
   │  • gate: issue OPEN + no rejected/force-manual + accepted/accepted-by-claude present
   │  • compute branch slug, detect language
   │  • emit develop-gate-outputs artifact
   │
   ▼ (workflow_run: develop-gate completed)
[Module 4 — code-generate] Claude codes
   │  • read issue + architecture map + named dirs only (context budget)
   │  • commit to head branch `claude/issue-N-slug`
   │  • emit code-generate-outputs artifact {branch_name, commit_sha, summary}
   │
   ▼ (workflow_run: code-generate completed)
[Module 4 — pr-lifecycle] push + open PR
   │  • push head branch (CLAUDE_DEV_PAT extraheader — S7 pipeline-fix)
   │  • open or reuse PR idempotently (issue #54)
   │  • apply in-review label (CLAUDE_DEV_PAT — fires downstream)
   │
   ▼ (pull_request.opened on branches targeting dev)
[Module 5] verify.yml (2-oracle: smoke + targeted)
   │  cutover LIVE — verify.yml owns the label transitions:
   │  verifying → verified (pass) | verify:failed (fail)
   │  self-verify.yml was deleted in the cutover PR.
   │
   ▼ (issues.labeled: verified)
[Module 6] Test (second isolated Claude Code process, tool-restricted tester)
   │
   ├─ passed → tested
   │
   └─ failed → test:failed
                │
                ├─ retry N < max: test:retry-N + maintainer manually
                │                 dispatches code-generate.yml (S2 — AI can
                │                 no longer apply maintainer-only `accepted`)
                │
                └─ retry N ≥ max: stage:failed → maintainer triage
   │
   ▼ (PR already has in-review label from pr-lifecycle)
[Module 8] Review (Claude initial + CODEOWNERS human final)
   │
   ▼ (approved + checks green)
[Module 9] Merge Queue ───────────────► merge + close issue + label: merged
```

### Two paths through Module 4 (M8 amendment)

| Path | When | Clarify loop? | Module 4 entry |
|---|---|---|---|
| **A — Fast** | `workload_class ∈ {trivial, standard}` | Skipped — triage applies `accepted-by-claude` directly | `workflow_run: clarify-loop` → develop-gate |
| **B — Clarify** | `workload_class == complex` (or unset) | Engaged — asks rounds, then accepts/yields/escalates | `workflow_run: clarify-loop` (accept conclusion) → develop-gate |
| **C — Reply** | `decision == reply` | n/a | Pipeline ends at triage comment |

Both A and B converge on the same `workflow_run` chain (develop-gate → code-generate → pr-lifecycle). Maintainer can override either path at any time by applying `rejected` or `force-manual`.

## Module ↔ engine ↔ trigger matrix

| Module | Engine | Trigger | Output Label / Artifact |
|---|---|---|---|
| 1 Issue Forms | GitHub native | `issues.opened` | structured Issue body |
| 2 Triage | Claude Code (cloud first-pass, GLM passthrough) | Module 1 event | Comment + `triage`; routes `work` by `workload_class` → `accepted-by-claude` (trivial/standard) or `needs-clarify` (complex) |
| 3' Clarify loop | Claude Code (multi-turn, GLM passthrough) | `labeled: needs-clarify` or `issue_comment` (author reply) | `accepted-by-claude` \| `yielded` \| `needs-ralph` (max-rounds fallback only) |
| 3 Judgement (REMOVED) | — | — | Module 3 workflow + composite action deleted. `needs-ralph` label remains as escalation signal for local ralph deep analysis only (no cloud workflow fires). |
| 3.5 Design review | Claude Code (+ human) | size threshold hit on `accepted` | Comment + `design-approved` |
| 4 Develop (M4 split into 3 workflows) | Claude Code (GLM passthrough) | `workflow_run: clarify-loop completed` | develop-gate → code-generate → pr-lifecycle (chain via cross-workflow artifacts) |
| 4a develop-gate | (preflight, no LLM) | `workflow_run` or `workflow_dispatch` | `develop-gate-outputs` artifact {issue_number, head_branch, base_branch, issue_language} |
| 4b code-generate | Claude Code (GLM passthrough) | `workflow_run: develop-gate completed` | branch push + `code-generate-outputs` artifact {branch_name, commit_sha, summary} |
| 4c pr-lifecycle | (glue, no LLM) | `workflow_run: code-generate completed` | Push (CLAUDE_DEV_PAT) + idempotent PR open + `in-review` label |
| 5 verify.yml (cutover LIVE) | Claude Code (2-oracle: smoke + targeted) | `pull_request.opened` / `.synchronize` targeting `dev` | summary PR comment + audit issue comment + `verifying` → `verified` / `verify:failed`. self-verify.yml deleted. Module 6 test composite runs in test.yml after `verified` applied (no duplication). |
| 6 Test | Claude Code (second isolated process, tool-restricted tester — PRD §4 amendment) | `issues.labeled: verified` | test report + `tested` / `test:failed`; on fail: `test:retry-N` (maintainer manually re-dispatches code-generate — S2 fix) |
| 7 PR open (REMOVED) | — | — | Module 7 v1 workflow + composite action deleted. `pr-lifecycle.yml` (M4c) opens the PR and applies `in-review` directly; the `tested → in-review` handoff is no longer needed. |
| 8 Review | Claude Code + CODEOWNERS | `pull_request.labeled: in-review` | AI initial review comment + human approval via CODEOWNERS |
| 9 Merge | GitHub Merge Queue | `pull_request_review: approved` + status checks green | Merge + Issue close + `merged` label |

See [`docs/labels.md`](labels.md) for the protocol layer, [`docs/composite-action-spec.md`](composite-action-spec.md) for action interfaces, and `CLAUDE.md` for the AI agent map.

## Module 6 engine amendment (2026-07-07)

> Originally PRD §4 specified Codex as Module 6's engine to provide out-of-distribution (OOD) testing — a different model family catching bugs the Claude-written code might share with a Claude tester. **Amended:** Module 6 now runs a **second isolated Claude Code process** with a tool-restricted reviewer profile.

**Why the amendment:**

- Maintainers cannot configure `OPENAI_API_KEY` (account / cost constraints). Module 6 v1 (Codex) was blocked end-to-end because the S4 secret guard correctly aborted on empty key.
- DeepSeek was considered (cheaper, different model family, retains OOD) but rejected by maintainer decision.
- The Claude engine already configured for Modules 2–5 (GLM passthrough via `ANTHROPIC_BASE_URL`) is reusable, unlocking full pipeline autonomy without new credentials.

**What we keep:**

- **Process isolation.** Module 6 spawns a fresh `claude-code-action` invocation with no conversation memory shared with Module 4/5.
- **Different prompt framing.** Module 6 prompt is tester-focused ("find what's missing, run the suite, do not write") — different attention pattern from Module 4 ("implement") and Module 5 ("verify acceptance criteria").
- **Tool restriction.** `allow: Read/Grep/Glob/Bash`, `deny: Write/Edit` — Module 6 cannot modify any file. Bash is permitted so the tester actually runs the test suite.
- **Optional model tier separation.** `vars.TEST_MODEL` can be set to a different Claude tier (e.g. Opus) than Module 4 (Sonnet default) for additional perspective diversity.

**What we lose:**

- Strict out-of-distribution testing. Same model family = shared training biases. Claude may miss bugs Claude introduced.

**Trade-off rationale:** A running pipeline with reduced OOD value is more valuable than a perfectly-designed pipeline that cannot execute. Module 6 v2 ships now; if OpenAI access becomes economical later, Module 6 can swap back to Codex via the existing engine-agnostic composite action interface (`engine` input).

## Coupling contract

Modules MUST NOT call each other directly. Every handoff is a Label transition or a GitHub event. This means:

- Any module can be replaced without touching its neighbors.
- Any module can be disabled by removing its trigger Label.
- Engine swap (Claude ↔ Codex) is a config change in the composite action, transparent to the workflow above it.
