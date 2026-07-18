# App v1 Architecture

> Front-end architecture for the GithubAutoDev SaaS App (path A, fully open-source,
> monorepo). Spec reference: [`docs/prd-app-v1.md`](./prd-app-v1.md) §4.1 (layered
> architecture), §4.4 (secret isolation), §7 (Day 0–30 MVP). Scaffold delivered by
> Issue #156; extended by Issues #2–#10.

This document describes the **v1 scaffold** shipped in `app/`. It is intentionally
minimal — only what the landing page + CI need. Each later issue fills in a layer.

## 1. Layered architecture (PRD §4.1)

```
┌──────────────────────────────────────────────────────────────┐
│  Presentation (src/app, src/components)                       │
│  Next.js App Router · React Server Components · shadcn/ui     │
└──────────────────────────────────────────────────────────────┘
                             ▲
┌──────────────────────────────────────────────────────────────┐
│  API / Edge (src/app/api/*, route handlers)                   │
│  GitHub OAuth callbacks (Issue #3) · Webhooks (Issue #4)      │
└──────────────────────────────────────────────────────────────┘
                             ▼
┌──────────────────────────────────────────────────────────────┐
│  Domain / Services (src/lib)                                  │
│  Auth (next-auth) · Billing (Stripe) · Queue (QStash)         │
└──────────────────────────────────────────────────────────────┘
                             ▼
┌──────────────────────────────────────────────────────────────┐
│  Data (Drizzle ORM → Postgres via `app/src/db/client.ts`) · Cache (Upstash Redis)        │
└──────────────────────────────────────────────────────────────┘
                             ▼
┌──────────────────────────────────────────────────────────────┐
│  Engine bridge — repository_dispatch / workflow_dispatch →    │
│  existing .github/actions/* pipeline modules (unchanged)      │
└──────────────────────────────────────────────────────────────┘
```

The App does **not** call pipeline modules directly. It triggers GitHub Actions
(`workflow_dispatch` / `repository_dispatch`) on the target repo, exactly as the
existing modules already communicate (PRD §2 — modules talk only via events &
labels). The `.github/actions/*` engines are out of scope and untouched (Issue #156
non-goals).

The authentication layer (Issue #3) lives in the API / Edge and Domain / Services
layers: `NextAuth GitHubProvider` configured in
[`app/src/auth/config.ts`](../app/src/auth/config.ts) handles the OAuth callback
at `/api/auth/*` (catch-all route in
[`app/src/app/api/auth/[...nextauth]/route.ts`](../app/src/app/api/auth/[...nextauth]/route.ts)),
issues a JWT session cookie, and
[`app/src/middleware.ts`](../app/src/middleware.ts) guards `/dashboard/*` and
`/settings/*` by checking the token with `next-auth/jwt` `getToken()`.

## 2. Data flow

```
GitHub event ──▶ Vercel API route (/api/webhook/github) ──▶ Postgres (state)
                     │                                        │
                     ├── SYNC lane: installation lifecycle ───┘
                     │
                     └── ASYNC lane ──▶ Upstash QStash (queue) ──▶ worker (Issue #5)
                                                                       │
                                                                       └──▶ workflow_dispatch ──▶ pipeline engine
```

1. **GitHub webhook** hits [`app/src/app/api/webhook/github/route.ts`](../app/src/app/api/webhook/github/route.ts)
   with `runtime = "nodejs"` and `dynamic = "force-dynamic"`.
2. **Signature verify** — raw body is read once via `request.text()` and verified
   against `X-Hub-Signature-256` using `crypto.timingSafeEqual` in
   [`webhook-verify.ts`](../app/src/lib/webhook-verify.ts). Failure → `401` (S10).
   Missing `WEBHOOK_SECRET` → `500` (logged, generic message — S4: never echo to GitHub).
3. **Event routing** ([`github-events.ts`](../app/src/lib/github-events.ts)) splits into:
   - **SYNC lane** (`installation`, `installation_repositories`) — processed inline via
     [`installations.ts`](../app/src/lib/installations.ts): `upsertInstallationFromEvent`
     creates/updates `tenants` + `installations` rows; `softDeleteInstallationFromEvent`
     sets `uninstalled_at` on uninstall (preserving FK target for historical `runs`).
   - **ASYNC lane** (`issues`, `issue_comment`, `pull_request`, `pull_request_review`, `label`)
     — enqueued to QStash via [`qstash.ts`](../app/src/lib/qstash.ts) with an
     action-aware key (e.g. `issues.opened`). The worker route `/api/webhook/github/worker`
     is Issue #5 scope.
4. All non-2xx paths return `200` to GitHub on internal errors to avoid retry storms;
   unrecognized events return `{ ignored: true }` (also 200).
5. The worker (Issue #5) dispatches `workflow_dispatch` to the target repo's pipeline.
6. Pipeline modules (triage → … → merge) run unchanged and report back via labels.

> v1 webhook entry point, signature verification, QStash enqueue, and installation
> sync ship in Issue #4. The QStash worker (`workflow_dispatch` engine trigger) lands in Issue #5.

## 6. Postgres schema (PRD §4.2)

The canonical schema definition lives at [`app/src/db/schema.ts`](../app/src/db/schema.ts),
with 5 tables (`tenants`, `installations`, `runs`, `usage_logs`, `api_keys`) defined via
Drizzle ORM `pgTable`. Migrations (generated SQL) are checked into
[`app/drizzle/`](../app/drizzle/).

| Table | Purpose | FK |
|---|---|---|
| `tenants` | Billing + identity root (GitHub org/user) | — |
| `installations` | GitHub App installation per repo | `tenant_id → tenants.id` |
| `runs` | Pipeline execution per Issue | `installation_id → installations.id` |
| `usage_logs` | Per-stage token / cost audit trail | `run_id → runs.id` |
| `api_keys` | Encrypted BYOK rows | `tenant_id → tenants.id` |

The runtime bridge is [`app/src/db/client.ts`](../app/src/db/client.ts): a `db` singleton
(Postgres pool + Drizzle ORM) guarded by `'server-only'` so it is never bundled into
client components.

## 3. Directory conventions

```
app/
  src/
    app/              # App Router: routes, layouts, route handlers
      layout.tsx      # root layout (html/body + Inter font + globals.css)
      page.tsx        # landing page placeholder
      globals.css     # Tailwind base + shadcn/ui CSS variables
      api/            # (Issue #3+) route handlers — auth callback, webhooks
    components/
      ui/             # shadcn/ui primitives (Button, …) — CLI-managed
    lib/              # cross-cutting helpers (cn, auth config, db client, …)
  components.json     # shadcn/ui CLI config (style, aliases, Tailwind linkage)
  tailwind.config.ts  # shadcn preset · content: ./src/**/*.{ts,tsx}
  tsconfig.json       # strict · paths { "@/*": ["./src/*"] }
```

Path alias `@/*` → `./src/*` (configured in `tsconfig.json`, consumed by Next,
`tsc`, and ESLint).

## 4. Secret isolation (PRD §4.4)

Every secret is an environment placeholder — never hardcoded. The full list lives
in [`app/.env.example`](../app/.env.example) and maps 1:1 to the dependency stack:

| Concern            | Env var(s)                                            |
| ------------------ | ----------------------------------------------------- |
| next-auth v4       | `NEXTAUTH_URL`, `NEXTAUTH_SECRET`                     |
| GitHub OAuth       | `GITHUB_ID`, `GITHUB_SECRET`                          |
| GitHub App / PAT   | `GITHUB_APP_ID`, `APP_PRIVATE_KEY`, `GITHUB_PAT`      |
| Postgres (Drizzle) | `DATABASE_URL`                                        |
| Upstash Redis      | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`  |
| Upstash QStash     | `QSTASH_URL`, `QSTASH_TOKEN`                          |
| Stripe             | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` |
| Public             | `NEXT_PUBLIC_APP_URL`                                 |

Operational rules (PRD §7):

- **S4** — secrets are never logged. Only `NEXT_PUBLIC_*` values reach the browser.
- **S6** — any PAT is fine-grained, single-repo, minimal perms, ≤90 days.
- `.env` / `.env.local` are gitignored (see `app/.gitignore`). Vercel injects them
  per-environment at deploy time.

## 6. Authentication flow (Issue #3)

```
GitHub OAuth authorize page
      │
      ▼ (redirect after user grants)
NextAuth /api/auth/callback/github
      │
      ▼ (jwt callback: store githubId + githubLogin + accessToken)
JWT cookie (next-auth.session-token)
      │
      ├──▶ middleware (src/middleware.ts) guards /dashboard/*, /settings/*
      │     └── unauthenticated → redirect /login?callbackUrl=<path>
      │
      └──▶ getServerSession(authOptions) in server components
            └── dashboard (src/app/dashboard/page.tsx) shows profile + installations
```

Key files:

| File | Role |
|---|---|
| [`app/src/auth/config.ts`](../app/src/auth/config.ts) | NextAuth options: `GitHubProvider` with `repo` scope, JWT strategy, session/user callbacks |
| [`app/src/app/api/auth/[...nextauth]/route.ts`](../app/src/app/api/auth/[...nextauth]/route.ts) | App Router catch-all route handler |
| [`app/src/middleware.ts`](../app/src/middleware.ts) | Edge middleware — `getToken()` check, redirect to `/login` |
| [`app/src/app/login/page.tsx`](../app/src/app/login/page.tsx) | Client component "Sign in with GitHub" button |
| [`app/src/app/dashboard/page.tsx`](../app/src/app/dashboard/page.tsx) | Server component — reads session, lists installations |
| [`app/src/auth/with-app-installer.ts`](../app/src/auth/with-app-installer.ts) | `getAppInstallationsForUser()` + `getAppInstallationToken()` (S11 cached ≤50 min) |
| [`app/src/lib/github-app-jwt.ts`](../app/src/lib/github-app-jwt.ts) | `signAppJwt()` — RS256 JWT via `jose`, 9-min expiry, cached PKCS8 key |

The provider uses `APP_CLIENT_ID` / `APP_CLIENT_SECRET` (GitHub App OAuth credentials).
Session strategy is `jwt` (no DB table — v1 simplification). Protected routes are
checked in middleware via `next-auth/jwt` `getToken()`; server components use
`getServerSession(authOptions)`.

## 7. CI

[`app-ci.yml`](../.github/workflows/app-ci.yml) runs only on `app/**` changes:
`pnpm lint` + `pnpm typecheck` + `pnpm build`, Node 20, `permissions: contents: read`
(S1 — App CI is read-only).
