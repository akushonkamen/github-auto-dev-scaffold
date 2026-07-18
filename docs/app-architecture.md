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
│  Data (Drizzle ORM → Postgres) · Cache (Upstash Redis)        │
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

## 2. Data flow

```
GitHub event ──▶ Vercel API route (webhook) ──▶ Postgres (state)
                     │                               │
                     ├──▶ Upstash QStash (queue)     │
                     │                               ▼
                     └──▶ workflow_dispatch ──▶ pipeline engine
```

1. **GitHub webhook** hits a Vercel route handler (`src/app/api/webhooks/github`).
2. The handler verifies the signature, persists the event to **Postgres** via
   Drizzle, and enqueues background work on **Upstash QStash**.
3. A worker dispatches a `workflow_dispatch` to the target repo's pipeline.
4. Pipeline modules (triage → … → merge) run unchanged and report back via labels.

> v1 scaffold ships only the static landing page. Steps 1–4 land in Issues #2–#4.

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

## 5. CI

[`app-ci.yml`](../.github/workflows/app-ci.yml) runs only on `app/**` changes:
`pnpm lint` + `pnpm typecheck` + `pnpm build`, Node 20, `permissions: contents: read`
(S1 — App CI is read-only).
