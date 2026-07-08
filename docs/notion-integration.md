# Notion Issue Mirror Integration

The Notion Issue mirror is a **side integration** that creates a Notion database page for every GitHub Issue in this repository and keeps it in sync as the Issue progresses through the pipeline. It is **not** a pipeline module — it only observes labels and module completion events.

## What it does

1. **Issue opened** → Creates a Notion page within 30 seconds with:
   - Title (Issue title)
   - Status (current top-priority label: triage, accepted, in-development, testing, in-review, merged, etc.)
   - GitHub Issue URL
   - PR URL (when available)
   - Labels (all current labels as multi-select)
   - Last Synced At (timestamp)
   - Freshness (formula: 🟢 if synced within 5 minutes, 🔴 stale if older)

2. **Label applied/removed** → Updates Notion page Status within 30 seconds

3. **Module workflow completes** → Appends module summary to Notion page body within 60 seconds (default branch) or 120 seconds (PR-scoped fallback):
   - triage, clarify-loop, judge, develop, self-verify, test, pr-open, review, merge-queue
   - Each summary includes: module name, run ID, duration, outcome, and key outputs

4. **Posts audit comment** → Within 2 minutes of issue open, a GitHub comment appears: `Notion mirror: <Notion page URL>`

## What it doesn't do (v1)

- **Notion → GitHub sync** is deferred to v2. Notion comments do **not** propagate back to GitHub Issues.
- **Multi-repo support** is v2. Each repo needs its own Notion database.
- **Label Timeline** shows only the most recent 50 events to avoid Notion block limits.
- **Manual edits** to Notion page body may be overwritten on module summary appends. Properties are source-of-truth.

## Prerequisites

- **Notion account** with permission to create integrations and databases
- **Repository admin** access (to add secrets and configure workflows)

## Step 1: Create Notion integration

1. Go to https://www.notion.so/my-integrations
2. Click "New integration"
3. Name: `GithubAutoDev Mirror` (or any descriptive name)
4. Associated workspace: select your target workspace
5. Type: "Internal" (recommended for this use case)
6. Capabilities: Keep "Read/update user content" unchecked for now — we'll grant database-specific access in Step 3
7. Click "Submit"
8. **Copy the "Internal Integration Token"** — it starts with `ntn_` (save this, you'll need it in Step 4)

## Step 2: Create Notion database

1. In your Notion workspace, create a new page
2. Add a **Table - Database** view
3. Name the database: `GitHub Issues Mirror` (or any name)
4. Click the "+" in the table header to add these properties:

| Property | Type | Notes |
|----------|------|-------|
| `Title` | Title | Notion's default — maps to Issue title |
| `Status` | Status | Options: `triage`, `needs-clarify`, `accepted`, `in-development`, `verifying`, `verified`, `testing`, `ready-for-pr`, `in-review`, `merged`, `rejected`, `needs-info`, `yielded`, `design-approved` |
| `GitHub Issue` | URL | Issue URL (e.g., `https://github.com/owner/repo/issues/123`) |
| `PR` | URL | PR URL when available (empty otherwise) |
| `Labels` | Multi-select | Maps to GitHub labels (created dynamically) |
| `Last Synced At` | Last edited time | Notion's built-in type |
| `Freshness` | Formula | Paste this formula: `if(prop("Last Synced At") > now() - 5 minutes, "🟢", "🔴 stale")` |

5. Click "Done" — your database schema is ready

## Step 3: Invite integration to database

1. In the database view, click the `•••` (more) menu in the top-right
2. Select "Add connections" → find your integration name (`GithubAutoDev Mirror`)
3. Click the integration to toggle it on (it should turn blue with a checkmark)
4. **Critical**: If you skip this step, the integration cannot read/write this database

## Step 4: Add GitHub repository secrets

Go to your GitHub repository → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:

| Name | Value |
|------|-------|
| `NOTION_API_KEY` | The `ntn_xxx` token from Step 1 (Internal Integration Token) |
| `NOTION_DATABASE_ID` | Database ID: open your Notion database, copy the UUID from the URL (`https://notion.so/workspace/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx?v=yyyyyy` — the `xxx...` part is the database ID) |

> **S3 compliance**: `NOTION_API_KEY` is scoped to the job level in `.github/workflows/notion-sync.yml` and never exposed at workflow level. The secret is fine-grained with database-only permissions, no workspace-wide access.

## Validation

### 1. Test issue creation

1. Open a new GitHub Issue in your repository
2. Within **30 seconds**, a new page should appear in your Notion database
3. Within **2 minutes**, a comment should appear on the GitHub Issue: `Notion mirror: <page URL>`
4. Verify the page properties: Title matches issue, Status shows `triage`, Labels populated

### 2. Test label sync

1. Apply the `accepted` label to the test Issue
2. Within **30 seconds**, the Notion page's `Status` field should update to `accepted`
3. Remove and re-apply labels — verify `Status` stays correct and no duplicate entries appear

### 3. Test module summary sync

1. Trigger a module workflow (e.g., push to a `claude/issue-*` branch to trigger `develop.yml`)
2. Within **60 seconds** (default branch) or **120 seconds** (PR-scoped fallback), the Notion page body should append a module summary block with the workflow name, run ID, and outcome

### 4. Test failure resilience

1. Temporarily revoke the Notion integration's database access (in Notion, remove the connection from Step 3)
2. Apply a label to trigger a sync
3. Verify that the GitHub pipeline continues normally — the workflow should log a sync failure and post an audit comment on the Issue, but not fail the job
4. Restore the integration and verify sync resumes

## Architecture notes

The integration consists of:

- **`.github/workflows/notion-sync.yml`**: Orchestrator workflow listening to `issues.opened`, `issues.labeled`, `issues.unlabeled`, `workflow_run.completed` (9 module workflows), and `push` to `claude/issue-*` branches (fallback for PR-scoped runs)
- **`.github/actions/notion-sync/action.yml`**: Composite action wrapper
- **`.github/actions/notion-sync/sync.mjs`**: Sync logic with idempotency keys and Notion API client

**Idempotency guarantees**:
- Label events: idempotency key `${issue_number}-${action}-${label_name}-${event_id}`
- Module summaries: idempotency key `${issue_number}-${module_name}-${run_id}`
- Same event replayed → no duplicate Notion API calls
- New run_id → append (never overwrite existing summaries)

**Triggers and SLAs**:
- `issues.opened` → Notion page in ≤30s, audit comment in ≤2min
- `issues.labeled/unlabeled` → Status update in ≤30s
- `workflow_run.completed` (default branch) → Module summary in ≤60s
- `push` to `claude/issue-*` (PR-scoped fallback) → Module summary in ≤120s

## v2 Roadmap

Planned enhancements for future releases:

1. **Notion → GitHub comment automation**: Use GitHub App + installation token to propagate Notion comments back to Issues (bidirectional sync)
2. **Multi-repo support**: Single Notion database aggregating Issues from multiple repos
3. **Label Timeline pagination**: Collapse/fold entries when >50 events
4. **Alternative PR branch patterns**: Support `feature/*`, `bugfix/*` beyond `claude/issue-*`
5. **Custom property mappings**: User-configurable Notion schema beyond the default set

## Security

All red lines (S1-S6) apply unchanged:

- **S1**: `notion-sync.yml` has explicit `permissions: contents: read, issues: write` — no `contents: write`
- **S2**: Integration never applies labels that trigger module transitions — it only reads labels
- **S3**: `NOTION_API_KEY` scoped to job-level `env:` in the sync job only, never workflow-global
- **S6**: `NOTION_API_KEY` is a fine-grained token with database-only permissions, 90-day rotation recommended

The integration does NOT trigger any label transitions. It is a passive observer that posts audit comments and updates external state (Notion) without affecting GitHub Issue flow.

## Related

- [`docs/architecture.md`](architecture.md) — Module table with "Module 10 (side): Notion mirror"
- [`CLAUDE.md`](../CLAUDE.md) — Side integrations section
- [`.github/workflows/notion-sync.yml`](../.github/workflows/notion-sync.yml) — Orchestrator workflow
- [`.github/actions/notion-sync/sync.mjs`](../.github/actions/notion-sync/sync.mjs) — Sync implementation
