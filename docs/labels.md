# Label state machine

> The Label taxonomy is the **protocol layer** of this repo. Every module communicates only via Labels and GitHub events (PRD §2 architecture principle). If a Label appears in any workflow, it MUST be defined here.

## Categories

| Category | Purpose | Owner | Mutability |
|---|---|---|---|
| `triage:*` | Triage funnel state | triage bot / maintainers | bot can apply; maintainers can remove |
| `stage:*` | Lifecycle stage of an accepted issue | maintainers + workflow bots | only workflow may transition forward |
| `type:*` | Issue category (intake) | Issue Forms auto-apply | maintainers may rewrite |
| `size:*` | Best-guess effort | Issue Forms / PR sizing bot | maintainers may rewrite |
| `force:*` | Per-issue override of global mode | maintainers only | maintainers only |
| `meta:*` | Administrative (closed/duplicate/wontfix) | maintainers only | maintainers only |

## Canonical Issue lifecycle (state diagram)

```mermaid
stateDiagram-v2
    [*] --> Opened: issue opened (type:*, triage)
    Opened --> Triaging: triage bot replies
    Triaging --> NeedsRalph: cloud first-pass flags deep analysis
    NeedsRalph --> Triaged: local ralph finishes (triage-done applied)
    Triaging --> Triaged: triage-done applied (high-confidence cloud decision)
    Triaged --> Accepted: judge (auto) or maintainer (manual)
    Triaged --> Rejected: judge or maintainer
    Triaged --> NeedsInfo: judge or maintainer
    NeedsInfo --> Triaging: author replies (re-triggers)
    Accepted --> DesignReview: size:XL hit
    DesignReview --> DesignApproved: design-approved
    Accepted --> InDevelopment: develop workflow picks up
    DesignApproved --> InDevelopment
    InDevelopment --> Verifying: branch pushed
    Verifying --> Testing: self-verify passed (verified)
    Verifying --> InDevelopment: self-verify failed (verify:failed)
    Testing --> ReadyForPR: tests passed (tested)
    Testing --> Testing: tests failed (test:failed → maintainer triage)
    ReadyForPR --> InReview: PR opened
    InReview --> Merged: approved + checks green
    InReview --> ReadyForPR: changes requested
    Merged --> [*]: issue auto-closed

    Opened --> Failed: stage:failed (any module)
    Triaging --> Failed: stage:failed
    Triaged --> Failed: stage:failed
    InDevelopment --> Failed: stage:failed
    Verifying --> Failed: stage:failed
    Testing --> Failed: stage:failed
    Failed --> [*]: maintainer triage
```

## Label reference

> All Labels below are mirrored in [`.github/labels.yml`](../.github/labels.yml) as the source of truth for label-sync tooling. The two files MUST stay in sync.

### triage:* (funnel state)

| Label | Description | Apply | Remove | Transitions to |
|---|---|---|---|---|
| `triage` | Newly opened, awaiting triage | Issue Forms auto-apply on `opened` | triage bot when posting reply | → `triage:replying` |
| `triage:replying` | Triage bot is composing first response | triage bot | triage bot when reply posted | → `triage-done` |
| `needs-ralph` | **v2**: emitted ONLY by clarify-loop.yml max-rounds fallback when Claude cannot reach clarity after N rounds | clarify-loop.yml (terminal exhaustion) | maintainer takeover | → `triage-done` (maintainer-driven ralph deep analysis) |
| `needs-clarify` | **v2**: cloud first-pass flagged; awaiting Module 3' clarify loop | triage-issue.yml (low-confidence `work` decisions only) | clarify-loop.yml on `accepted-by-claude` / `yielded` / max-rounds fallback | → `accepted-by-claude` \| `yielded` \| `needs-ralph` |
| `clarify-r-1` / `clarify-r-2` / `clarify-r-3` | **v2**: state marker — Claude asked a round-N question, awaiting author reply | clarify-loop.yml dispatch shell (round N) | clarify-loop.yml (next round / resolution) | → next round or resolution label |
| `accepted-by-claude` | **v2**: Claude self-acceptance after clarify loop reached clarity (S2 amendment — distinct from maintainer-only `accepted`) | clarify-loop.yml dispatch shell only | develop.yml on branch creation | → `in-development` |
| `yielded` | **v2**: Claude yielded; maintainer takeover requested | clarify-loop.yml dispatch shell | maintainer | maintainer applies next label |
| `triage-done` | Maintainer accept/reject decision pending (v1 maintainer-driven path) | local handle-triage.sh (v1, after ralph finishes) OR maintainer manual | maintainer when applying `accepted`/`rejected` | → `accepted` \| `rejected` \| `needs-info` |

### Decision vocabulary mapping (cloud ↔ Module 3')

The cloud first-pass emits `decision ∈ {reply, work}` × `confidence ∈ [0,1]`. The v2 Module 3' clarify loop emits `action ∈ {ask, accept, yield}`. Mapping:

| Cloud decision + confidence | Module 3' routing | Module 3' action | Resulting label |
|---|---|---|---|
| `work` + low conf | queue clarify loop (`needs-clarify`) | `ask` (round N) | `clarify-r-N` |
| `work` + low conf | (after round N) | `accept` | `accepted-by-claude` |
| `work` + low conf | (after round N) | `yield` | `yielded` |
| `work` + low conf | (rounds exhausted, max-rounds fallback) | n/a — emits `needs-ralph` | `needs-ralph` (the ONLY v2 path that emits `needs-ralph`) |
| `work` + high conf | auto-accept (no clarify loop) | n/a | `accepted` (maintainer-only via `AUTO_ACCEPT_ENABLED=true`) |
| `reply` + any conf | v1 maintainer path (no clarify loop) | n/a | maintainer manual |

### accepted-by-claude state machine (S2 amendment)

`accepted-by-claude` is the v2 S2-amendment label that lets Claude self-accept
an issue after the clarify loop reaches clarity, while preserving the
maintainer-only `accepted` invariant. Rules:

(a) **Applied by** the clarify-loop.yml dispatch shell only, after Claude's
    sealed JSON returns `action=accept`. Re-fetched label race-check (AC-V2-8b)
    aborts the apply if `rejected`, `force-manual`, or `accepted` was added by
    a maintainer during the run.
(b) **Removed by** the develop.yml workflow on branch creation (replaced with
    `in-development`). Maintainers can force removal via `force-manual` or
    `rejected` (both halt the clarify loop in preflight).
(c) **Coexists with** `accepted`: either label triggers develop.yml (AC-V2-12).
    A maintainer may apply `accepted` at any time to override the Claude path
    and force Module 4 entry; the two labels are mutually exclusive in practice
    (develop.yml removes both on pickup).

See [`docs/security.md#s2-amendment`](security.md#s2-amendment) for the full
containment list (sealed JSON schema, dispatch shell, `--disallowedTools`,
DENY_LIST, AC-V2-8b race guard, AC-V2-13a log-scan).

### Stage labels (terminal states for the issue lifecycle)

> These are applied by workflows, not humans. PRD §6 failure mode is `stage:failed`.

| Label | Description | Apply | Remove | Notes |
|---|---|---|---|---|
| `accepted` | Issue accepted for development | judge (auto mode) or maintainer (manual mode) | develop workflow on pickup | Triggers Module 4 |
| `rejected` | Issue will not be worked | judge or maintainer | maintainer only | Terminal |
| `needs-info` | Author must clarify | judge or maintainer | triage bot on new comment | Re-enters funnel |
| `design-review` | Needs design proposal first | judge workflow on `size:XL` + `accepted` | design-review workflow on completion | Triggers Module 3.5 |
| `design-approved` | Design accepted, may develop | design-review workflow | — | Unlocks Module 4 |
| `in-development` | Module 4 active | develop workflow | develop workflow on push | — |
| `verifying` | Module 5 (self-verify) active | self-verify workflow | self-verify workflow | → `verified` \| `verify:failed` |
| `verified` | Module 5 self-verify passed | self-verify workflow | test workflow | → `testing` |
| `verify:failed` | Module 5 self-verify failed; needs maintainer review | self-verify workflow | maintainer | → maintainer triage |
| `testing` | Module 6 (test) active | test workflow | test workflow | → `tested` \| `test:failed` |
| `tested` | Module 6 test passed | test workflow | pr-open workflow | → `ready-for-pr` |
| `test:failed` | Module 6 test failed; needs maintainer review | test workflow | maintainer | → maintainer triage |
| `ready-for-pr` | Tests passed; PR may be opened | test workflow | pr-open workflow | — |
| `in-review` | PR opened, Module 8 active | pr-open workflow | review workflow | — |
| `merged` | Module 9 complete | merge-queue workflow | — | Terminal |
| `stage:failed` | A module failed; needs maintainer triage | any failing workflow | maintainer | PRD §6 失败降级 |

### type:* (intake)

Auto-applied by Issue Forms. Maintainers may rewrite.

| Label | Description |
|---|---|
| `type:bug` | Defect report |
| `type:feature` | New capability |
| `type:incident` | Production incident (used by PRD §2 module 10 二期) |
| `type:dependencies` | Dependabot / dependency bump |
| `type:question` | Support question (no code change expected) |

### size:* (effort guess)

| Label | Threshold | Triggers design review? |
|---|---|---|
| `size:S` | < 50 LOC, single file | no |
| `size:M` | one module | no |
| `size:L` | cross-module | optional |
| `size:XL` | architectural | **yes** (Module 3.5) |

### force:* (mode override)

| Label | Description | Precedence |
|---|---|---|
| `force-manual` | Force `manual` triage mode for this issue regardless of `TRIAGE_MODE` repo variable | beats `auto` and `hybrid` global settings (PRD §3) |
| `pipeline-fix` | Pipeline-fix escape hatch: sanctioned bypass for fixing broken pipeline (maintainer only) | allows direct PR to `dev`/`main` scoped to `.github/workflows/` + `.github/actions/` + `docs/security.md`; audit comment mandatory (S7) |

### meta:* (administrative)

| Label | Description |
|---|---|
| `meta:duplicate` | Closed as duplicate of #N |
| `meta:wontfix` | Closed without action |
| `meta:invalid` | Not a valid issue for this repo |

## Legal transitions (invariants)

A workflow MUST NOT:

- Apply `accepted` to an Issue that lacks `triage-done`. (Gate for S2 — see [`security.md`](security.md).)
- Apply `accepted-by-claude` outside the clarify-loop.yml dispatch shell. (Gate for S2 amendment — see [`security.md#s2-amendment`](security.md#s2-amendment).)
- Apply `in-development` to an Issue that lacks `accepted` OR `accepted-by-claude` OR `design-approved` (if `design-review` was triggered).
- Apply `merged` to an Issue whose linked PR is not in `in-review` AND approved AND green.
- Remove `stage:failed` except via maintainer action.

A workflow MUST:

- Apply exactly one label per transition (atomic).
- Post an audit comment for every transition (PRD §3 Audit invariant).
- Refuse to act if the precondition label is missing — log to `stage:failed` instead.

## Coexistence v1 + v2

The repository supports both v1 (local ralph poller) and v2 (cloud clarify loop)
simultaneously. Isolation is enforced by **label separation**:

| Path | Trigger label | Path owner | Implementation |
|---|---|---|---|
| v1 maintainer-driven ralph | `needs-ralph` | local `poll.sh` (POLL_ENABLED=true) | `scripts/local/handle-triage.sh` |
| v2 cloud clarify loop | `needs-clarify` | cloud `clarify-loop.yml` | `.github/actions/clarify` composite |
| v2 max-rounds fallback | `needs-ralph` (re-emitted by clarify-loop.yml) | local `poll.sh` (POLL_ENABLED=true) OR maintainer manual | `scripts/local/handle-triage.sh` |

**AC-V2-12b:** if `POLL_ENABLED=true` and an issue has `needs-clarify` label,
`poll.sh` skips it (the issue is owned by the v2 cloud path). The `poll.sh`
script only polls for `accepted` and `needs-ralph`; it never polls `needs-clarify`,
so the isolation is structural.

**Maintainer escape hatches:**
- `force-manual` halts both v1 and v2 paths in preflight (PRD §3 mode override).
- `rejected` halts both paths; transition to terminal.
- `accepted` overrides any Claude path and forces Module 4 entry.

## Source of truth

- [`docs/labels.md`](labels.md) (this file) — human-readable spec & state machine
- [`.github/labels.yml`](../.github/labels.yml) — machine-readable declaration consumed by label-sync tooling

If the two disagree, `.github/labels.yml` is the deployable truth and `docs/labels.md` is the design intent. Open a `type:bug` issue to reconcile.
