CREATE TABLE IF NOT EXISTS "tenants" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"github_id" bigint NOT NULL,
	"github_login" text NOT NULL,
	"plan" text DEFAULT 'free',
	"stripe_customer_id" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tenants_github_id_unique" ON "tenants" USING btree ("github_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "installations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"installation_id" bigint NOT NULL,
	"tenant_id" bigint NOT NULL REFERENCES "tenants"("id"),
	"repo_full_name" text NOT NULL,
	"installed_at" timestamp with time zone DEFAULT now(),
	"uninstalled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "installations_installation_id_unique" ON "installations" USING btree ("installation_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"installation_id" bigint NOT NULL REFERENCES "installations"("id"),
	"issue_number" integer NOT NULL,
	"pr_number" integer,
	"current_stage" text,
	"status" text,
	"ai_tokens_used" integer DEFAULT 0,
	"ai_minutes_used" real DEFAULT 0,
	"started_at" timestamp with time zone DEFAULT now(),
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_runs_installation_id" ON "runs" USING btree ("installation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_runs_issue_number" ON "runs" USING btree ("issue_number");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" bigint NOT NULL REFERENCES "runs"("id"),
	"stage" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd" numeric(10, 4),
	"called_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_usage_logs_run_id" ON "usage_logs" USING btree ("run_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "api_keys" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" bigint NOT NULL REFERENCES "tenants"("id"),
	"provider" text NOT NULL,
	"encrypted_key" text NOT NULL,
	"key_hint" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"rotated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_api_keys_tenant_id" ON "api_keys" USING btree ("tenant_id");
