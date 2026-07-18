import {
  bigint,
  bigserial,
  index,
  integer,
  numeric,
  pgTable,
  real,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import type { InferSelectModel } from "drizzle-orm";

// ── Tenants ───────────────────────────────────────────────────────────────
// Each row = one GitHub org or user that has installed the GitHub App.
// PRD §4.2: tenant = billing + identity root.
export const tenants = pgTable("tenants", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  githubId: bigint("github_id", { mode: "number" }).notNull().unique(),
  githubLogin: text("github_login").notNull(),
  plan: text("plan").default("free"),
  stripeCustomerId: text("stripe_customer_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ── Installations ────────────────────────────────────────────────────────
// Each row = one GitHub App installation (one repo under a tenant).
// FK → tenants.id; installation_id is GitHub's idempotency key.
export const installations = pgTable("installations", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  installationId: bigint("installation_id", { mode: "number" })
    .notNull()
    .unique(),
  tenantId: bigint("tenant_id", { mode: "number" })
    .notNull()
    .references(() => tenants.id),
  repoFullName: text("repo_full_name").notNull(),
  installedAt: timestamp("installed_at", { withTimezone: true }).defaultNow(),
  uninstalledAt: timestamp("uninstalled_at", { withTimezone: true }),
});

// ── Runs ─────────────────────────────────────────────────────────────────
// Each row = one pipeline execution triggered by an Issue.
// FK → installations.id; tracks status + cost for billing (Issue #9).
export const runs = pgTable(
  "runs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    installationId: bigint("installation_id", { mode: "number" })
      .notNull()
      .references(() => installations.id),
    issueNumber: integer("issue_number").notNull(),
    prNumber: integer("pr_number"),
    currentStage: text("current_stage"),
    status: text("status"),
    aiTokensUsed: integer("ai_tokens_used").default(0),
    aiMinutesUsed: real("ai_minutes_used").default(0),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => ({
    installationIdx: index("idx_runs_installation_id").on(table.installationId),
    issueNumberIdx: index("idx_runs_issue_number").on(table.issueNumber),
    // One run per (installation, issue) — query-then-upsert without this races
    // under concurrent dispatches. With the constraint, runs.ts uses
    // onConflictDoUpdate for atomicity.
    installationIssueUnique: unique("uq_runs_installation_issue").on(
      table.installationId,
      table.issueNumber,
    ),
  }),
);

// ── Usage Logs ───────────────────────────────────────────────────────────
// Per-stage token / cost audit trail. FK → runs.id.
// Invoice rows are aggregated from this table (Issue #10 Stripe).
export const usageLogs = pgTable(
  "usage_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    runId: bigint("run_id", { mode: "number" })
      .notNull()
      .references(() => runs.id),
    stage: text("stage").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    costUsd: numeric("cost_usd", { precision: 10, scale: 4 }),
    calledAt: timestamp("called_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    runIdIdx: index("idx_usage_logs_run_id").on(table.runId),
  }),
);

// ── API Keys ─────────────────────────────────────────────────────────────
// Encrypted BYOK rows. FK → tenants.id.
// Actual AES-256-GCM encrypt/decrypt lands in Issue #8.
export const apiKeys = pgTable(
  "api_keys",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tenantId: bigint("tenant_id", { mode: "number" })
      .notNull()
      .references(() => tenants.id),
    provider: text("provider").notNull(),
    encryptedKey: text("encrypted_key").notNull(),
    keyHint: text("key_hint"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    rotatedAt: timestamp("rotated_at", { withTimezone: true }),
  },
  (table) => ({
    tenantIdIdx: index("idx_api_keys_tenant_id").on(table.tenantId),
  }),
);

// ── Schema barrel ────────────────────────────────────────────────────────
export const schema = {
  tenants,
  installations,
  runs,
  usageLogs,
  apiKeys,
};

// ── Row types (InferSelectModel) ─────────────────────────────────────────
export type Tenant = InferSelectModel<typeof tenants>;
export type Installation = InferSelectModel<typeof installations>;
export type Run = InferSelectModel<typeof runs>;
export type UsageLog = InferSelectModel<typeof usageLogs>;
export type ApiKey = InferSelectModel<typeof apiKeys>;
