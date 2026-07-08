CREATE TABLE "ai_calls" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ai_calls_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"workspace_id" text NOT NULL,
	"import_id" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer,
	"outcome" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_calls_outcome_check" CHECK ("ai_calls"."outcome" in ('ok', 'invalid_json_retried', 'fallback_used'))
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"mode" text NOT NULL,
	"key_hash" "bytea" NOT NULL,
	"last4" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash"),
	CONSTRAINT "api_keys_mode_check" CHECK ("api_keys"."mode" in ('test', 'live'))
);
--> statement-breakpoint
CREATE TABLE "import_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "import_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"import_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"actor" text NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_events_actor_check" CHECK ("import_events"."actor" in ('system', 'end_user', 'developer_api', 'dashboard'))
);
--> statement-breakpoint
CREATE TABLE "import_rows" (
	"import_id" text NOT NULL,
	"row_no" integer NOT NULL,
	"workspace_id" text NOT NULL,
	"raw" jsonb NOT NULL,
	"data" jsonb,
	"status" text DEFAULT 'staged' NOT NULL,
	"errors" jsonb,
	"dedup_hash" "bytea",
	"batch_no" integer,
	"edited" boolean DEFAULT false NOT NULL,
	CONSTRAINT "import_rows_import_id_row_no_pk" PRIMARY KEY("import_id","row_no"),
	CONSTRAINT "import_rows_status_check" CHECK ("import_rows"."status" in ('staged', 'valid', 'invalid', 'excluded', 'delivered', 'accepted', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "imports" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"schema_id" text NOT NULL,
	"upload_id" text NOT NULL,
	"schema_version" integer NOT NULL,
	"end_user_org" text,
	"status" text DEFAULT 'created' NOT NULL,
	"failure_reason" jsonb,
	"validation_policy" text NOT NULL,
	"duplicate_policy" text NOT NULL,
	"delimiter" text,
	"encoding" text,
	"headers" jsonb,
	"column_samples" jsonb,
	"proposed_mapping" jsonb,
	"confirmed_mapping" jsonb,
	"mapping_source" text,
	"row_count" integer DEFAULT 0 NOT NULL,
	"valid_count" integer DEFAULT 0 NOT NULL,
	"invalid_count" integer DEFAULT 0 NOT NULL,
	"excluded_count" integer DEFAULT 0 NOT NULL,
	"delivered_count" integer DEFAULT 0 NOT NULL,
	"accepted_count" integer DEFAULT 0 NOT NULL,
	"rejected_count" integer DEFAULT 0 NOT NULL,
	"last_parsed_row" integer DEFAULT 0 NOT NULL,
	"last_validated_row" integer DEFAULT 0 NOT NULL,
	"last_delivered_batch" integer DEFAULT 0 NOT NULL,
	"error_summary" jsonb,
	"error_report_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "imports_upload_id_unique" UNIQUE("upload_id"),
	CONSTRAINT "imports_status_check" CHECK ("imports"."status" in ('created', 'parsing', 'mapping', 'awaiting_review', 'validating', 'awaiting_confirm', 'importing', 'completed', 'failed', 'rolling_back', 'rolled_back', 'cancelled')),
	CONSTRAINT "imports_validation_policy_check" CHECK ("imports"."validation_policy" in ('reject_file', 'import_valid_only', 'require_all_valid')),
	CONSTRAINT "imports_duplicate_policy_check" CHECK ("imports"."duplicate_policy" in ('keep_first', 'keep_last', 'exclude_all', 'abort')),
	CONSTRAINT "imports_mapping_source_check" CHECK ("imports"."mapping_source" in ('cache', 'ai', 'fallback'))
);
--> statement-breakpoint
CREATE TABLE "mapping_cache" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"schema_id" text NOT NULL,
	"schema_version" integer NOT NULL,
	"header_signature" text NOT NULL,
	"mapping" jsonb NOT NULL,
	"source" text NOT NULL,
	"hit_count" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mapping_cache_source_check" CHECK ("mapping_cache"."source" in ('ai', 'human'))
);
--> statement-breakpoint
CREATE TABLE "schemas" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"fields" jsonb NOT NULL,
	"validation_policy" text DEFAULT 'import_valid_only' NOT NULL,
	"duplicate_policy" text DEFAULT 'keep_first' NOT NULL,
	"default_phone_region" text,
	"ai_samples_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "schemas_validation_policy_check" CHECK ("schemas"."validation_policy" in ('reject_file', 'import_valid_only', 'require_all_valid')),
	CONSTRAINT "schemas_duplicate_policy_check" CHECK ("schemas"."duplicate_policy" in ('keep_first', 'keep_last', 'exclude_all', 'abort'))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uploads" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"storage_key" text NOT NULL,
	"filename" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"declared_mime" text,
	"consumed_by_import_id" text,
	"delete_after" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_counters" (
	"workspace_id" text NOT NULL,
	"period" date NOT NULL,
	"rows_imported" bigint DEFAULT 0 NOT NULL,
	"imports_completed" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "usage_counters_workspace_id_period_pk" PRIMARY KEY("workspace_id","period")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"email_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"import_id" text NOT NULL,
	"endpoint_id" text NOT NULL,
	"type" text NOT NULL,
	"batch_no" integer,
	"idempotency_key" text NOT NULL,
	"payload" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_retry_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_deliveries_type_check" CHECK ("webhook_deliveries"."type" in ('rows.batch', 'import.completed', 'import.rollback')),
	CONSTRAINT "webhook_deliveries_status_check" CHECK ("webhook_deliveries"."status" in ('pending', 'succeeded', 'failed', 'exhausted'))
);
--> statement-breakpoint
CREATE TABLE "webhook_delivery_attempts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "webhook_delivery_attempts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"delivery_id" text NOT NULL,
	"attempt_no" integer NOT NULL,
	"response_status" integer,
	"response_body" text,
	"error" text,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"mode" text NOT NULL,
	"url" text NOT NULL,
	"secret_ciphertext" "bytea" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_endpoints_mode_check" CHECK ("webhook_endpoints"."mode" in ('test', 'live'))
);
--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_members_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id"),
	CONSTRAINT "workspace_members_role_check" CHECK ("workspace_members"."role" in ('owner', 'admin', 'member'))
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"embed_secret_ciphertext" "bytea" NOT NULL,
	"retention_days" integer DEFAULT 7 NOT NULL,
	"ai_daily_call_limit" integer DEFAULT 500 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "workspaces_plan_check" CHECK ("workspaces"."plan" in ('free', 'starter', 'growth'))
);
--> statement-breakpoint
ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_events" ADD CONSTRAINT "import_events_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_schema_id_schemas_id_fk" FOREIGN KEY ("schema_id") REFERENCES "public"."schemas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_upload_id_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."uploads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mapping_cache" ADD CONSTRAINT "mapping_cache_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mapping_cache" ADD CONSTRAINT "mapping_cache_schema_id_schemas_id_fk" FOREIGN KEY ("schema_id") REFERENCES "public"."schemas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schemas" ADD CONSTRAINT "schemas_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_counters" ADD CONSTRAINT "usage_counters_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_delivery_attempts" ADD CONSTRAINT "webhook_delivery_attempts_delivery_id_webhook_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."webhook_deliveries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_calls_workspace_created_idx" ON "ai_calls" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "api_keys_workspace_idx" ON "api_keys" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "import_events_import_idx" ON "import_events" USING btree ("import_id","id");--> statement-breakpoint
CREATE INDEX "import_rows_status_idx" ON "import_rows" USING btree ("import_id","status","row_no");--> statement-breakpoint
CREATE INDEX "import_rows_dedup_idx" ON "import_rows" USING btree ("import_id","dedup_hash") WHERE "import_rows"."dedup_hash" is not null;--> statement-breakpoint
CREATE INDEX "import_rows_batch_idx" ON "import_rows" USING btree ("import_id","batch_no") WHERE "import_rows"."batch_no" is not null;--> statement-breakpoint
CREATE INDEX "imports_workspace_created_idx" ON "imports" USING btree ("workspace_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "imports_transient_status_idx" ON "imports" USING btree ("status") WHERE "imports"."status" in ('parsing', 'mapping', 'validating', 'importing', 'rolling_back');--> statement-breakpoint
CREATE UNIQUE INDEX "mapping_cache_lookup_uq" ON "mapping_cache" USING btree ("schema_id","schema_version","header_signature");--> statement-breakpoint
CREATE UNIQUE INDEX "schemas_workspace_key_uq" ON "schemas" USING btree ("workspace_id","key");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "uploads_delete_after_idx" ON "uploads" USING btree ("delete_after");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_uq" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_deliveries_idem_uq" ON "webhook_deliveries" USING btree ("endpoint_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_workspace_idx" ON "webhook_deliveries" USING btree ("workspace_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "webhook_deliveries_import_idx" ON "webhook_deliveries" USING btree ("import_id");--> statement-breakpoint
CREATE INDEX "webhook_delivery_attempts_delivery_idx" ON "webhook_delivery_attempts" USING btree ("delivery_id","attempt_no");--> statement-breakpoint
CREATE INDEX "webhook_endpoints_workspace_idx" ON "webhook_endpoints" USING btree ("workspace_id");