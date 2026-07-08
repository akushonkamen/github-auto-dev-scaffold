# Notion Issue mirror integration (Module 10 side)

> Side integration — observes labels and module completion events but does NOT
> trigger label transitions (S2 preserved).

## Overview

The Notion integration mirrors GitHub Issue state into a Notion database. Each
issue becomes a Notion page with properties reflecting its current pipeline
stage, labels, and module completion summaries.

It is an **observer**, not a pipeline module: `notion-sync.yml` watches events
but never applies labels or makes decisions.

## Setup (4 steps)

### 1. Create a Notion integration

1. Go to [https://www.notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Click **+ New integration**
3. Name it (e.g. "GithubAutoDev Sync")
4. Select the workspace that contains your target database
5. Copy the **Internal Integration Secret** (starts with `ntn_` or `secret_`)

### 2. Create the Notion database

Create a database in Notion with these properties (names must match exactly):

| Property | Type | Description |
|---|---|---|
| `Issue ID` | Text | GitHub issue identifier ("#43") |
| `Title` | Title | Issue title |
| `Status` | Select | "Open" / "Closed" |
| `Labels` | Multi-select | Current label set |
| `Module Stage` | Select | Latest pipeline stage |
| `Last Updated` | Date | ISO timestamp of last sync |
| `Issue URL` | URL | Link to GitHub issue |
| `Summary` | Text | Module summaries concatenated |
| `Event` | Text | Last triggering event type |

### 3. Share the database with the integration

1. Open the Notion database page
2. Click **...** → **Connections** → **Connect to**
3. Select your integration from the list

Copy the database ID from the URL (`notion.so/<database-id>?v=...`).

### 4. Configure GitHub secrets and variables

In the repository **Settings → Secrets and variables → Actions**:

**Secrets:**
- `NOTION_API_KEY` — your Notion integration secret

**Variables:**
- `NOTION_DATABASE_ID` — the Notion database ID from step 3

### Optional

- `NOTION_LABEL_PROPERTY` — override the Notion property name for labels
  (defaults to `Labels`; change this if your Notion DB uses a different name)

## v1 boundaries

- Sync is **one-way** (GitHub → Notion). Notion changes do NOT propagate back
  to GitHub issues.
- Module summaries only enrich the page for `workflow_run.completed` events;
  direct issue events (opened/labeled/unlabeled) mirror issue state only.
- The Notion database schema is **not** auto-created — create it manually via
  the Notion UI (see step 2).
- Multi-select label options in Notion may need to be pre-populated for colors
  to render correctly (Notion limitation — labels with no pre-existing option
  display as gray).

## Architecture

```
GitHub Issue event
    │
    ▼
notion-sync.yml (observer)
    │
    ├── issues.opened/labeled/unlabeled → mirror labels + state
    ├── workflow_run.completed          → fetch module-summary artifact
    ├── push (claude/issue-*)           → mirror branch activity
    │
    ▼
.github/actions/notion-sync/sync.mjs
    │
    ├── fetchIssue()      — GitHub API
    ├── readModuleSummaries() — artifacts
    ├── upsertPage()      — Notion API (create or update)
    │
    ▼
Notion database page ← synced
```

## Security

- `NOTION_API_KEY` is scoped per-job via `env` on the sync step in
  `notion-sync.yml` — never workflow-global (S3).
- The workflow has `permissions: contents: read, issues: write, actions: read`
  (S1 — never `contents: write`).
- This integration does NOT trigger label transitions — it is a read-only
  observer for GitHub state (S2).
- No secrets are printed in logs (S4) — sync.mjs uses `safe()` redaction on
  all log output.

## Known limitations

- The Notion API rate limits at 3 requests/second for most plans. The sync
  retries on 429 with exponential backoff (up to 3 retries).
- Module summary artifacts are only available for `workflow_run.completed`
  triggers — direct issue events cannot access the triggering workflow's
  artifacts without a `workflow_run` context.
