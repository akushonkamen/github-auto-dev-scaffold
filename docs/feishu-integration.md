# Feishu (Lark) Integration — Setup & Architecture

> Module 10 — side integration. Mirrors GitHub Issue state to Feishu Bitable
> and pushes event notifications to a Feishu chat. **Side-only**: this
> integration observes labels and module completion events but does NOT
> trigger label transitions (S2 preserved).

This document covers v1 boundaries (PR-1 through PR-6 of the feishu plan).
The authoritative plan lives at `.omc/plans/feishu-integration-v1.md`; the
crystallized spec lives at `.omc/specs/deep-interview-feishu-integration.md`.

## v1 Boundaries

What v1 ships:

- **PR-1** — Docs + `feishu-sync` action skeleton (safe() redaction, silent skip)
- **PR-2** — Event notification (postCard to a Feishu chat on `review.completed`)
- **PR-3** — Bitable mirror (upsert Issue row on label transitions)
- **PR-4** — Local bridge process (WebSocket long connection, AES-encrypted PAT)
- **PR-5** — `/approve` command + Approve/Request Changes buttons
- **PR-6** — CODEOWNERS-aware approval routing

What v1 does NOT ship:

- No public callback URL required (uses WebSocket long connection)
- No multi-repo fanout (single repo binding per bridge instance)
- No cross-workspace Bitable rollup
- No OAuth user-token flow for end users (tenant_access_token only)

Phase B migration triggers (recorded in plan ADR Follow-ups):

- bridge instances > 1 (multi-repo) OR
- bound users > 10 OR
- Bitable JSON payload > 1 MB OR
- bridge uptime > 30 days continuous

## Step 1 — Create Feishu Custom App

1. Open [Feishu Open Platform](https://open.feishu.cn/app) → **Create Custom App**
2. Fill in app name (suggest `github-autodev-<repo>`) and description
3. Note the **App ID** (`cli_...`) and **App Secret** (32 hex chars) — these
   become `FEISHU_APP_ID` and `FEISHU_APP_SECRET`
4. Under **Permissions & Scopes**, add the following 6 scopes:

| # | Scope | Why |
|---|---|---|
| 1 | `im:message:send_as_bot` | Post event cards to chat |
| 2 | `im:message.group_at_msg:read` | Read `/approve` commands when bot is @-mentioned in group |
| 3 | `im:chat:readonly` | Resolve chat_id from invite link / name |
| 4 | `bitable:app` | Read + write Bitable rows (Issue mirror) |
| 5 | `bitable:app:readonly` | Read table schema for column id mapping |
| 6 | `contact:group:readonly` | Validate chat membership for approvers |

5. Under **Event Subscriptions**, choose **Long Connection (WebSocket)** mode.
   Subscribe to `im.message.receive_v1` (PR-4 onward). **No public callback
   URL needed.**
6. Under **Bot**, enable the bot capability so the app can be added to a chat.
7. **Publish** the app version. Until published, tenant_access_token calls
   return `app has no effective scope`.

## Step 2 — Create Feishu Chat & Add Bot

1. Create a new Feishu group chat (suggest `github-autodev-<repo>-alerts`)
2. Add the bot from step 1 to the chat (chat settings → bots → add)
3. Open chat settings → **More** → **Chat ID** — copy the value
   (`oc_...`) into `FEISHU_CHAT_ID`

## Step 3 — Create Bitable Issue Table

1. In Feishu Docs, create a new Bitable (多维表格)
2. Note the **app_token** from the URL: `https://xxx.feishu.cn/base/{app_token}`
3. Rename the default table to `Issues`, note its **table_id**
4. Add 6 columns with **exact** names (PR-3 will map these by name):

| Column Name | Type | Notes |
|---|---|---|
| `Issue Number` | Number | e.g. `100` |
| `Title` | Text | Issue subject |
| `State` | Single Select | `triage`, `accepted`, `verifying`, `verified`, `in-review`, `merged` |
| `Labels` | Multi Select | Mirror of GitHub labels |
| `Assignees` | Multi Select | sha256(open_id)[:12] — PII redaction |
| `Updated At` | DateTime | Last sync timestamp |

5. Copy `app_token` → `FEISHU_BITABLE_APP_TOKEN`, `table_id` → `FEISHU_BITABLE_TABLE_ID`

## Step 4 — Configure GitHub Secrets & Variables

### Secrets (scoped per workflow job, S3)

| Secret | Required | Notes |
|---|---|---|
| `FEISHU_APP_ID` | PR-2 | App ID from step 1.3 |
| `FEISHU_APP_SECRET` | PR-2 | App Secret from step 1.3 (32 hex) |
| `FEISHU_CHAT_ID` | PR-2 | `oc_...` from step 2.3 |
| `FEISHU_BITABLE_APP_TOKEN` | PR-3 | From step 3.2 |
| `FEISHU_BITABLE_TABLE_ID` | PR-3 | From step 3.3 |
| `FEISHU_VERIFICATION_TOKEN` | PR-4 | Optional in PR-1; required for bridge callback signature |
| `FEISHU_BRIDGE_PAT_MASTER_KEY` | PR-4 | **NOT a secret value — see Keychain section below** |

### Repository Variables (workflow-level, non-secret)

None required for v1. The bridge reads repo meta from `gh api` at runtime.

### Where to set

```bash
gh secret set FEISHU_APP_ID --repo owner/name --body "cli_..."
gh secret set FEISHU_APP_SECRET --repo owner/name --body "32hex..."
gh secret set FEISHU_CHAT_ID --repo owner/name --body "oc_..."
gh secret set FEISHU_BITABLE_APP_TOKEN --repo owner/name --body "bascn..."
gh secret set FEISHU_BITABLE_TABLE_ID --repo owner/name --body "tbl..."
gh secret set FEISHU_VERIFICATION_TOKEN --repo owner/name --body "ver..."
```

## Keychain Master Key (PR-4 onward — bridge PAT encryption)

The local bridge process persists an AES-256-GCM-encrypted GitHub PAT on
disk so it can call the GitHub API on behalf of the user. The encryption
master key MUST be stored in macOS Keychain (or `pass` on Linux) — **never
in a `.env` file, never as a GitHub secret, never in shell rc**.

### One-time setup (PR-4 install path)

```bash
# Generate a 32-byte random key
KEY=$(openssl rand -base64 32)

# Store in macOS Keychain (service: feishu-bridge, account: <repo-full-name>)
security add-generic-password \
  -s "feishu-bridge" \
  -a "owner/name" \
  -w "$KEY" \
  -U

# Verify retrieval
security find-generic-password -s "feishu-bridge" -a "owner/name" -w
```

### Why Keychain

- OS-level access control — other processes cannot read without Keychain unlock
- Auditable via `security dump-keychain` / Keychain Access.app
- Tied to user session — reboots require unlock, fails closed
- Aligns with S6 (PAT handling red line) — PAT material is encrypted at rest
  with a key that never enters CI

If Keychain is unavailable (CI / container), the bridge refuses to start.
**There is no env-var fallback by design.**

## Step 5 — Smoke Test (PR-2 onward)

After PR-2 lands and secrets are set:

1. Open any Issue on the repo, label it `accepted`
2. Wait for the `review.completed` event (run Module 8 on a PR)
3. Check the Feishu chat — a card should appear within 30 seconds

If silent skip is observed in workflow logs:

```
[INFO] FEISHU_APP_ID missing — silent skip (event=... issue=...)
```

…then at least one required secret was not injected. Re-check step 4.

## Architecture (data flow)

```
GitHub Event                    feishu-sync action              Feishu
─────────────                   ──────────────────              ──────
issues.labeled        ─┐
workflow_run.completed├──► observer workflow ──► sync.mjs ──► postCard (chat)
pull_request.reviewed ─┘                                └─►► bitable.upsert (table)

                                                          ▲
                                                          │
                                                  (PR-4 onward)
                                                          │
Local Bridge (macOS host)                                 │
──────────────────────────                                │
  Feishu WebSocket ───► /approve parser ───► gh api ──────┘
                       (decrypts PAT via
                        Keychain master key)
```

- **PR-1**: skeleton only — no API calls, safe() redaction + silent skip
- **PR-2**: postCard path implemented (chat notifications)
- **PR-3**: bitable.upsert path implemented (Issue state mirror)
- **PR-4**: local bridge added (WebSocket long connection)
- **PR-5**: `/approve` command + interactive card buttons
- **PR-6**: CODEOWNERS-aware routing (calls `@github/codeowners` with
  mandatory ETag invalidation)

## Security Posture (mapped to S1-S7)

| Line | How this integration honors it |
|---|---|
| S1 | feishu-sync action only requests `issues: read`, `contents: read` — never `contents: write` |
| S2 | Observer only — does NOT apply or remove any GitHub label |
| S3 | All `FEISHU_*` secrets scoped per-job in calling workflow, never workflow-global |
| S4 | `safe()` redacts Feishu (4 formats) + GitHub (5 formats) tokens + 32-hex App Secret from all logs |
| S5 | Bridge runs as user-level process; no `--dangerously-skip-permissions` style bypass |
| S6 | PAT encrypted at rest with AES-256-GCM, master key in Keychain (no env fallback) |
| S7 | Every change to this integration (`.github/actions/feishu-sync/`, this doc, observer workflow) goes through Issue→PR with mandatory `pipeline-fix` audit comment |

## References

- [Feishu Open Platform docs](https://open.feishu.cn/document/) — API reference
- [Feishu WebSocket long connection](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/feishu-events/long-connection) — event subscription overview
- [`docs/notion-integration.md`](./notion-integration.md) — sibling side integration (same pattern)
- [`.omc/plans/feishu-integration-v1.md`](../.omc/plans/feishu-integration-v1.md) — authoritative implementation plan
- [`docs/security.md`](./security.md) — S1-S7 operational playbook
