# Triage modes & confidence threshold

> **HISTORICAL (v1 — pre-M8)** — This document describes the v1 model where a
> `judge.yml` workflow consumed `TRIAGE_MODE` (`auto` \| `manual` \| `hybrid`)
> and `HYBRID_CONFIDENCE_THRESHOLD` to decide whether to auto-apply
> `accepted` / `rejected`. **judge.yml was deleted in PR #76** (pipeline-fix
> cleanup) — the cloud flow no longer applies maintainer-only state labels.
>
> The post-M8 pipeline uses:
> - `triage-issue.yml` to apply `accepted-by-claude` (Claude self-acceptance,
>   S2 amendment) for `workload_class ∈ {trivial, standard}`.
> - `clarify-loop.yml` for `workload_class == complex`, with `accepted-by-claude`
>   emitted only after the author satisfies the multi-turn clarify loop.
> - `accepted` / `rejected` / `needs-info` remain maintainer-only (S2).
>
> The threshold-calibration methodology in §3 below is still valid for future
> tuning of triage confidence reporting; the workflow mechanics described here
> are not. Retained for traceability — do NOT execute as-is.

> PRD §3 (mode switch), PRD §8 item 5 (threshold calibration). This document is the source of truth for the `TRIAGE_MODE` and `HYBRID_CONFIDENCE_THRESHOLD` knobs.

## The three modes

| Mode | Behavior | Set by |
|---|---|---|
| `auto` | Judge module decides and applies `accepted`/`rejected`/`needs-info` directly. | global only |
| `manual` | Judge module posts suggestion comment only; maintainer applies the label. | global or per-issue (`force-manual`) |
| `hybrid` (default) | If judge confidence ≥ threshold → auto-apply; else fall through to manual. | global only |

**The protocol is mode-independent** — the protocol invariant (audit comment + label transition) holds in every mode. The mode only decides **who** applies the label. This is the loose-coupling key (PRD §3 协议不变量).

## Configuration

### Global (repo-level)

Set the GitHub repository variable:

```
TRIAGE_MODE = auto | manual | hybrid   # default: hybrid
HYBRID_CONFIDENCE_THRESHOLD = 0.0..1.0 # default: 0.7
```

The judge workflow (`.github/workflows/judge.yml`) reads these via `${{ vars.TRIAGE_MODE }}` and `${{ vars.HYBRID_CONFIDENCE_THRESHOLD }}`. Defaults are applied inline if unset.

### Per-issue override

Apply the `force-manual` label to any issue to force `manual` mode regardless of global setting. This is the safety valve for high-stakes issues where you don't trust the auto-judge. See [`docs/labels.md`](labels.md) `force:*` category.

## Mode resolution priority

```
1. force-manual label present?   → mode = manual
2. vars.TRIAGE_MODE set?         → mode = that value
3. otherwise                     → mode = hybrid (default)
```

Implementation: `.github/workflows/judge.yml` `resolve-mode` step.

## Threshold semantics

The threshold only governs the `hybrid` branch:

```
confidence ≥ HYBRID_CONFIDENCE_THRESHOLD  →  auto-apply decision
confidence <  HYBRID_CONFIDENCE_THRESHOLD  →  fall through to manual (suggestion only)
```

- The confidence value is produced by the judge composite action's LLM output schema (`{ decision, confidence, reason }`).
- Both branches post the **same audit comment** (PRD §3 Audit invariant). The audit comment records the mode, confidence, threshold, and whether auto-apply fired.

## Audit comment template

Every judged issue gets an audit comment of this form (from `.github/actions/judge/apply.sh`):

```markdown
<!-- githubautodev:judge-audit -->
## Module 3 — Judgement audit
- **Decision:** `accepted` | `rejected` | `needs-info`
- **Mode:** `auto` | `manual` | `hybrid`
- **Confidence:** `0.83`
- **Threshold:** `0.7`
- **Action taken:** (auto-applied by Module 3 in `hybrid` mode, ...) | (suggestion only — ...)

### Reason
<one paragraph justification>
```

The hidden HTML marker lets the action find and overwrite its prior audit comment on re-runs (idempotency, PRD §6).

## Calibration procedure <a name="calibration"></a>

PRD §8 item 5 says the threshold is **待试运行标定** (pending operational calibration). The default of `0.7` is a placeholder; the real value must be measured from production data using the procedure below.

### Step 1 — Collect

Run the judge in **manual mode** for the first 50+ issues across all categories (`type:bug`, `type:feature`, etc.). This produces audit comments with `decision`, `confidence`, and `reason` without auto-applying anything.

### Step 2 — Ground truth

A maintainer independently re-reviews each judged issue and records the **correct** decision. This is the ground-truth label for calibration.

### Step 3 — Sweep

For each candidate threshold `t ∈ {0.5, 0.6, 0.7, 0.8, 0.9}`:

- Define the auto-apply set: issues where `confidence ≥ t`.
- Compute precision = (correct auto-applies) / (total auto-applies).
- Compute recall = (correct auto-applies) / (all correct decisions).
- Compute F1 = harmonic mean.

### Step 4 — Pick

Choose the threshold that maximizes F1 **subject to** `precision ≥ 0.85`. Precision is the floor — a low-precision auto-judge will produce visible wrong labels at `accepted`/`rejected`, eroding trust in the pipeline faster than a low-recall one.

### Step 5 — Set

Update the repo variable:

```
HYBRID_CONFIDENCE_THRESHOLD = <chosen value>
```

Document the calibration run in a `type:feature` issue linked from this doc, with the sweep table.

### Re-calibration cadence

Re-run the procedure:

- After any model change (Claude or Codex model ID swap).
- After any prompt change in the judge composite action.
- Quarterly as a sanity check.

## Changing modes in production

| You want to ... | Action |
|---|---|
| Disable auto-apply repo-wide | Set `TRIAGE_MODE = manual`. Judge still produces decisions in audit comments for visibility. |
| Disable AI entirely | Set `TRIAGE_MODE = manual` and stop wiring the judge workflow. Maintainers apply `accepted` etc. by hand. |
| Force one issue to manual | Apply `force-manual` label to that issue. |
| Go full auto | Set `TRIAGE_MODE = auto`. **Only do this after calibration shows precision ≥ 0.95.** |
