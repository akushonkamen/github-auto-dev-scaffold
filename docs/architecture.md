# Architecture

## Pipeline overview

```
Issue opened
   │
   ▼
[Module 1] Issue Forms (GitHub native)
   │
   ▼ (issues.opened)
[Module 2] Triage reply ──────────────► label: triage
   │
   ▼ (labeled: triage-done)
[Module 3] Need judgement ────────────► label: accepted | rejected | needs-info
   │                                          │
   │                                          └── (large issue) ──► [3.5 Design review] ► design-approved
   ▼ (labeled: accepted|design-approved)
[Module 4] Develop ───────────────────► feature branch + impl notes
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
| 2 Triage | Claude Code | Module 1 event | Comment + `triage` |
| 3 Judgement | Claude Code (+ human fallback) | `labeled: triage-done` | `accepted` / `rejected` / `needs-info` |
| 3.5 Design review | Claude Code (+ human) | size threshold hit on `accepted` | Comment + `design-approved` |
| 4 Develop | Claude Code | `labeled: accepted` | feature branch + impl notes |
| 5 Self-verify | Claude Code | branch push | verify report |
| 6 Test | Codex + CI | Module 5 passed | test report + coverage |
| 7 PR open | Claude Code | Module 6 passed | Draft / ready PR |
| 8 Review | Claude Code + CODEOWNERS | `pull_request.opened` | Approve / Request changes |
| 9 Merge | GitHub Merge Queue | status checks + approval | Merge + Issue close |

See [`docs/labels.md`](labels.md) for the protocol layer, [`docs/composite-action-spec.md`](composite-action-spec.md) for action interfaces, and `CLAUDE.md` for the AI agent map.

## Coupling contract

Modules MUST NOT call each other directly. Every handoff is a Label transition or a GitHub event. This means:

- Any module can be replaced without touching its neighbors.
- Any module can be disabled by removing its trigger Label.
- Engine swap (Claude ↔ Codex) is a config change in the composite action, transparent to the workflow above it.
