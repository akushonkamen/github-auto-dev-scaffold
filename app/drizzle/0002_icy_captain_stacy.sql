CREATE TABLE IF NOT EXISTS "projects" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"installation_id" bigint NOT NULL,
	"source_issue_id" integer NOT NULL,
	"complexity_class" text NOT NULL,
	"status" text DEFAULT 'planning' NOT NULL,
	"dag_json" text,
	"budget_usd" numeric(10, 4) DEFAULT '10.0000',
	"budget_days" integer DEFAULT 3,
	"budget_prs" integer DEFAULT 15,
	"scaffold_mode" text DEFAULT 'standard',
	"pipeline_version" text DEFAULT 'v0.1.0',
	"created_at" timestamp with time zone DEFAULT now(),
	"completed_at" timestamp with time zone,
	"blocked_at" timestamp with time zone,
	CONSTRAINT "uq_projects_installation_issue" UNIQUE("installation_id","source_issue_id")
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "installation_id" bigint;--> statement-breakpoint
ALTER TABLE "installations" ADD COLUMN "pipeline_version" text DEFAULT 'v0.1.0';--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "project_id" bigint;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "projects" ADD CONSTRAINT "projects_installation_id_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."installations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_projects_installation_id" ON "projects" USING btree ("installation_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_installation_id_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."installations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "runs" ADD CONSTRAINT "runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_api_keys_installation_id" ON "api_keys" USING btree ("installation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_runs_project_id" ON "runs" USING btree ("project_id");