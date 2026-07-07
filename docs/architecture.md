# Architecture

## Pipeline overview

```
Issue opened
   │
   ▼
[Module 1] Issue Forms (GitHub native)
   │
   ▼ (issues.opened)
[Module 2] Triage (cloud first-pass) ──► label: triage
   │
   │  decision==reply (v1 path)           decision==work && low-conf (v2 path)
   │  (maintainer manual triage)          ▼
   │                                  [Module 3'] Clarify loop (Claude multi-turn)
   │                                      │
   │                                      ├── ask → clarify-r-N (await author reply)
   │                                      ├── accept → accepted-by-claude
   │                                      ├── yield → yielded (maintainer takeover)
   │                                      └── max-rounds exhausted → needs-ralph
   │                                        (ONLY v2 path that emits needs-ralph;
   │                                         maintainer-driven ralph deep analysis)
   │
   ▼ (labeled: accepted | accepted-by-claude | design-approved)
[Module 4] Develop ───────────────────► feature branch + PR
   │
   ▼ (branch push)
[Module 5] Self-verify (ruff/mypy/clippy/rustfmt + build)
   │
   ▼
[Module 6] Test (second Claude Code process — tool-restricted tester, v2)
   │
   ▼
[Module 7] Open PR (Claude)
   │
   ▼ (pull_request.opened)
[Module 8] Review (AI initial + human final via CODEOWNERS)
   │
   ▼ (approved + checks green)
[Module 9] Merge Queue ───────────────► merge + close issue
```

## Module ↔ engine ↔ trigger matrix

| Module | Engine | Trigger | Output Label / Artifact |
|---|---|---|---|
| 1 Issue Forms | GitHub native | `issues.opened` | structured Issue body |
| 2 Triage | Claude Code (cloud first-pass, GLM passthrough) | Module 1 event | Comment + `triage`; conditional `needs-clarify` for v2 clarify loop |
| 3' Clarify loop | Claude Code (multi-turn, GLM passthrough) | `labeled: needs-clarify` or `issue_comment` (author reply) | `accepted-by-claude` \| `yielded` \| `needs-ralph` (max-rounds fallback only) |
| 3 Judgement (v1, legacy) | ralph (local) + maintainer | `labeled: needs-ralph` → local poll.sh → `triage-done` | structured analysis JSON → maintainer applies `accepted` / `rejected` / `needs-info` |
| 3.5 Design review | Claude Code (+ human) | size threshold hit on `accepted` | Comment + `design-approved` |
| 4 Develop | Claude Code (GLM passthrough) | `labeled: accepted` OR `accepted-by-claude` | feature branch + PR (CLAUDE_DEV_PAT as PR opener) |
| 5 Self-verify | Claude Code (GLM passthrough, v2) | `pull_request.opened` / `.synchronize` on `claude/issue-*` branches targeting `dev` | verify report + `verified` / `verify:failed` label (shipped) |
| 6 Test | Claude Code (second isolated process, tool-restricted tester — PRD §4 amendment) | `issues.labeled: verified` | test report + `tested` / `test:failed` label (shipped, v2) |
| 7 PR open | Claude Code (GLM passthrough) | `issues.labeled: tested` | ready-for-review comment + `in-review` label on PR ✅ LIVE |
| 8 Review | Claude Code + CODEOWNERS | `pull_request.labeled: in-review` | AI initial review comment + human approval via CODEOWNERS ✅ LIVE |
| 9 Merge | GitHub Merge Queue | status checks + approval | Merge + Issue close |

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
