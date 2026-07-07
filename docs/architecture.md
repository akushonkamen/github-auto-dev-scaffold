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
[Module 6] Test (Codex generates + runs selective CI)
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
| 6 Test | Codex (out-of-distribution tester, PRD §4) | `issues.labeled: verified` | test report + `tested` / `test:failed` label (shipped) |
| 7 PR open | Claude Code (GLM passthrough) | `issues.labeled: tested` | ready-for-review comment + `in-review` label on PR ✅ LIVE |
| 8 Review | Claude Code + CODEOWNERS | `pull_request.labeled: in-review` | AI initial review comment + human approval via CODEOWNERS ✅ LIVE |
| 9 Merge | GitHub Merge Queue | status checks + approval | Merge + Issue close |

See [`docs/labels.md`](labels.md) for the protocol layer, [`docs/composite-action-spec.md`](composite-action-spec.md) for action interfaces, and `CLAUDE.md` for the AI agent map.

## Coupling contract

Modules MUST NOT call each other directly. Every handoff is a Label transition or a GitHub event. This means:

- Any module can be replaced without touching its neighbors.
- Any module can be disabled by removing its trigger Label.
- Engine swap (Claude ↔ Codex) is a config change in the composite action, transparent to the workflow above it.
