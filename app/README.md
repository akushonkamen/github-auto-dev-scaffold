# GithubAutoDev App (v1)

Next.js 14 (App Router) front-end for the GithubAutoDev Issue → Merge automation
pipeline. This is the v1 scaffold — subsequent issues (#2–#10) extend it.

- Architecture: [`docs/app-architecture.md`](../docs/app-architecture.md)
- MVP scope: [`docs/prd-app-v1.md`](../docs/prd-app-v1.md) §7 (Day 0–30)

## Stack

- **Next.js 14** (App Router) · **React 18** · **TypeScript 5**
- **Tailwind CSS 3** + **shadcn/ui** (CLI mode, `components.json`)
- **next-auth v4** (Issue #3) · **Drizzle ORM** (Issue #2) · **Upstash** · **Stripe**

## Local development

```bash
pnpm install
cp .env.example .env.local   # fill in the placeholders
pnpm dev                      # http://localhost:3000
```

> Requires Node ≥ 20 and pnpm 9 (`corepack enable` if pnpm is missing).

## Scripts

| Script            | Description                          |
| ----------------- | ------------------------------------ |
| `pnpm dev`        | Start the dev server                 |
| `pnpm build`      | Production build                     |
| `pnpm start`      | Run the production build             |
| `pnpm lint`       | ESLint via `next lint`               |
| `pnpm typecheck`  | `tsc --noEmit`                       |

## Layout

```
src/
  app/            # App Router routes (layout.tsx, page.tsx, globals.css)
  components/ui/  # shadcn/ui primitives (Button, …)
  lib/            # helpers (cn, …)
```

Path alias `@/*` → `./src/*` (see `tsconfig.json`).
