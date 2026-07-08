# Test plan — triage-ralph v1 baseline

> Baseline reference for triage-ralph v1 (shipped). Every section maps to a concrete
> integration point: `.github/actions/triage/action.yml`, `.github/actions/triage/extract.sh`,
> `.github/workflows/triage-issue.yml`. Foundation against which the triage-clarify-v2
> test plan will be diffed.

## Purpose

triage-ralph v1 is Module 2 of the GithubAutoDev pipeline. When a new Issue is
opened, claude analyzes title and body, decides `reply` (needs clarification / out
of scope / duplicate) or `work` (enter the development pipeline), and emits structured
JSON. The caller workflow posts the comment and applies the `triage` label.

This test plan documents fixtures, parser unit, rapid-comment integration, and
boundary round-counter so any v1 regression is caught before the clarify-loop (v2)
upgrade lands.

## 1. Test fixtures

### 1.1 Directory layout

Fixtures live under `tests/fixtures/triage-ralph-v1/` (this plan is the spec):

```
tests/fixtures/triage-ralph-v1/
├── issues/    # valid-bug, valid-feature, empty-body, spam, duplicate, needs-clarify
├── outputs/   # expected-reply, expected-work, expected-parse-fail, expected-empty
└── README.md
```

### 1.2 Fixture schema

Each `issues/*.json` matches the payload from `gh issue view --json title,body,labels,url`:

```json
{"title":"Bug: login unresponsive on Safari","body":"Steps:\n1. Safari\n2. /login\n3. Sign In\n\nExpected: submit\nActual: nothing","labels":[{"name":"bug"}],"url":"https://github.com/akushonkamen/github-auto-dev-scaffold/issues/99"}
```

`outputs/expected-*.json` contains the expected `structured_output` from claude-code-action
(or a malformed variant for error-path tests).

### 1.3 Coverage matrix

| Fixture | Input | Expected | Tests |
|---|---|---|---|
| `valid-bug.json` | detailed bug report | `work` | happy-path, parser |
| `valid-feature.json` | feature request with AC | `work` | happy-path, parser |
| `empty-body.json` | `body: "(empty)"` | `reply` | edge-case |
| `spam.json` | gibberish | `reply` | out-of-scope |
| `duplicate.json` | "dup of #12" | `reply` | dedup |
| `needs-clarify.json` | no repro steps | `reply` | clarification |

## 2. Parser unit (`extract.sh`)

### 2.1 What the parser does

`extract.sh` receives `structured_output` JSON from claude-code-action, validates
against the triage schema (`decision` ∈ `{"reply","work"}`, `comment_body` ≥ 10 chars,
`suggested_labels` array, `confidence` [0,1]), extracts fields with `jq`, and emits
`comment_body` via heredoc into `GITHUB_OUTPUT`. Invalid/empty input → exit 1.

### 2.2 Test cases

| # | Test | Input | Expected |
|---|---|---|---|
| P1 | Happy — `work` | valid JSON, decision=work | exit 0; outputs populated |
| P2 | Happy — `reply` | valid JSON, decision=reply | exit 0; comment ≥ 10 chars |
| P3 | Empty input | `STRUCTURED=""` | exit 1; `::error::` emitted |
| P4 | Missing `confidence` | `{decision, comment_body, labels}` | exit 1; schema fails |
| P5 | Wrong type | `"confidence": "high"` | exit 1; type-check fails |
| P6 | Bad enum | `"decision": "maybe"` | exit 1; enum fails |
| P7 | Short body | `"comment_body": "ok"` | exit 1; minLength |
| P8 | Empty labels | `"suggested_labels": []` | exit 0; empty string |
| P9 | Trailing whitespace | valid JSON + newline | exit 0; `jq` handles |
| P10 | Non-JSON | plain text / HTML | exit 1; parse error |

## 3. Rapid-comment integration

### 3.1 End-to-end flow

The triage-issue workflow (`.github/workflows/triage-issue.yml`) orchestrates:
fetch issue context → build claude config → invoke claude-code-action (engine-agnostic)
→ parse via extract.sh → post comment as github-actions[bot] → apply `triage` label
→ optionally apply `accepted` if auto-accept enabled and decision=`work`.

### 3.2 Integration scenarios

| # | Scenario | Setup | Expected |
|---|---|---|---|
| C1 | Bug → work | Realistic bug issue | comment + `triage` + `accepted` (auto-accept on) |
| C2 | Underspecified → reply | No repro steps | comment asks for clarification, `triage` only |
| C3 | Empty body → reply | Empty body | graceful, comment asks for details |
| C4 | Auto-accept OFF | `AUTO_ACCEPT_ENABLED=false` | comment + `triage`, NO `accepted` |
| C5 | Comment dedup | Re-run same issue | no duplicate (HTML marker check) |
| C6 | Dry-run | `dry-run: true` | no label, no comment; outputs parsed |
| C7 | GLM passthrough | `ANTHROPIC_BASE_URL` set | routed to GLM; same schema enforced |

### 3.3 Comment dedup marker

Every triage comment MUST include an HTML marker as its first line:

```html
<!-- triage-ralph-v1 -->
```

The caller workflow uses this to skip duplicates on re-run.

## 4. Boundary / round-counter

### 4.1 max-turns enforcement

The composite action passes `max-turns` (default: 6) into claude-code-action settings:

```json
{"permissions":{"allow":["Read","Grep","Glob"],"deny":["Write","Edit","Bash"]},"maxTurns":6}
```

If the agent exceeds `maxTurns` without producing valid `structured_output`, the action fails.

### 4.2 Boundary test cases

| # | Test | max-turns | Expected |
|---|---|---|---|
| B1 | Normal | 6 | completes in 1–2 turns |
| B2 | Minimum | 1 | may fail if >1 turn needed |
| B3 | Large budget | 20 | completes; no regression |
| B4 | Exhaustion | 1 (complex issue) | action fails; extract.sh → exit 1 |
| B5 | Near-exhaustion | 3 (finishes turn 3) | valid output emitted |

### 4.3 Round-counter logging (v1.1 candidate)

Workflow should log at step start:
`[INFO] triage-ralph-v1 starting: max-turns=6, engine=claude, issue=#44`
Not yet implemented — tracked in the triage-clarify-v2 plan.

## 5. Regression guard

### 5.1 Pre-upgrade checklist

Before upgrading to triage-clarify-v2, run the full v1 suite and confirm:

- [ ] Parser unit tests P1–P10 pass
- [ ] Integration scenarios C1–C7 pass
- [ ] Boundary tests B1–B5 pass
- [ ] Dedup marker present in every v1 comment
- [ ] No v1 workflow run took >3 turns

### 5.2 v1 → v2 diff points

The triage-clarify-v2 plan extends this baseline with:

- Multi-turn clarification loop (up to N rounds, configurable)
- `needs-clarify` → `accepted-by-claude` | `yielded` | `needs-ralph` transitions
- Round-counter state persisted across workflow invocations
- Fallback to `needs-ralph` when max rounds exhausted

Every v1 test case must still pass after v2 deploys (no regression in the baseline
`reply`/`work` decision path).

## 6. References

- [Module 2 composite action](../.github/actions/triage/action.yml)
- [extract.sh parser](../.github/actions/triage/extract.sh)
- [triage-issue workflow](../.github/workflows/triage-issue.yml)
- [Composite action spec](./composite-action-spec.md) — Module 2 interface
- [Quickstart: triage](./quickstart-triage.md)
- [PRD (project root)](../PRD.md) — §2 module 2, §7 S1 permissions
*Generated 2026-07-08 — baseline for triage-clarify-v2 diff.*
