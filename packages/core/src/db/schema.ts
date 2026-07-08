// Drizzle schema — direct translation of docs/03-database-design.md.
// Conventions (docs/03 §1): text PKs with prefixes, workspace_id on every
// table, timestamptz, text + CHECK for statuses, jsonb validated by Zod,
// ON DELETE RESTRICT everywhere.

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import {
  AI_OUTCOMES,
  CACHE_SOURCES,
  DELIVERY_STATUSES,
  DELIVERY_TYPES,
  DUPLICATE_POLICIES,
  EVENT_ACTORS,
  IMPORT_STATUSES,
  KEY_MODES,
  MAPPING_SOURCES,
  MEMBER_ROLES,
  PLANS,
  ROW_STATUSES,
  TRANSIENT_IMPORT_STATUSES,
  VALIDATION_POLICIES,
} from "../constants";
import type {
  ErrorSummaryEntry,
  FailureReason,
  MappingEntry,
  RowError,
  SchemaField,
} from "../types";

const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).defaultNow().notNull();

// CHECK (col IN (...)); NULL passes, which is what we want for nullable columns
const oneOf = (column: AnyPgColumn, values: readonly string[]) =>
  sql`${column} in (${sql.raw(values.map((v) => `'${v}'`).join(", "))})`;

// ---------------------------------------------------------------- control plane

export const workspaces = pgTable(
  "workspaces",
  {
    id: text("id").primaryKey(), // ws_…
    name: text("name").notNull(),
    plan: text("plan", { enum: PLANS }).notNull().default("free"),
    // signs embed JWTs; AES-256-GCM under MASTER_KEY. Rotation = revocation.
    embedSecretCiphertext: bytea("embed_secret_ciphertext").notNull(),
    retentionDays: integer("retention_days").notNull().default(7),
    aiDailyCallLimit: integer("ai_daily_call_limit").notNull().default(500),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [check("workspaces_plan_check", oneOf(t.plan, PLANS))],
);

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(), // usr_…
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(), // argon2id
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("users_email_lower_uq").on(sql`lower(${t.email})`)],
);

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    role: text("role", { enum: MEMBER_ROLES }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId] }),
    check("workspace_members_role_check", oneOf(t.role, MEMBER_ROLES)),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(), // sess_… (random 256-bit, cookie holds only this)
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey(), // key_…
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    mode: text("mode", { enum: KEY_MODES }).notNull(),
    keyHash: bytea("key_hash").notNull().unique(), // sha256; raw key shown once
    last4: text("last4").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }), // write-throttled
    createdAt: createdAt(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    index("api_keys_workspace_idx").on(t.workspaceId),
    check("api_keys_mode_check", oneOf(t.mode, KEY_MODES)),
  ],
);

export const schemas = pgTable(
  "schemas",
  {
    id: text("id").primaryKey(), // sch_…
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    key: text("key").notNull(), // "contacts"
    name: text("name").notNull(),
    version: integer("version").notNull().default(1), // bumped on ANY field/policy change
    fields: jsonb("fields").$type<SchemaField[]>().notNull(), // ordered; Zod-validated on write
    validationPolicy: text("validation_policy", { enum: VALIDATION_POLICIES })
      .notNull()
      .default("import_valid_only"),
    duplicatePolicy: text("duplicate_policy", { enum: DUPLICATE_POLICIES })
      .notNull()
      .default("keep_first"),
    defaultPhoneRegion: text("default_phone_region"), // e.g. 'IN' for the E.164 transform
    aiSamplesEnabled: boolean("ai_samples_enabled").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("schemas_workspace_key_uq").on(t.workspaceId, t.key),
    check("schemas_validation_policy_check", oneOf(t.validationPolicy, VALIDATION_POLICIES)),
    check("schemas_duplicate_policy_check", oneOf(t.duplicatePolicy, DUPLICATE_POLICIES)),
  ],
);

export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: text("id").primaryKey(), // whe_…
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    mode: text("mode", { enum: KEY_MODES }).notNull(),
    url: text("url").notNull(), // HTTPS enforced in live mode at the app layer
    // HMAC signing secret — must be recoverable to sign, so encrypted, not hashed
    secretCiphertext: bytea("secret_ciphertext").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("webhook_endpoints_workspace_idx").on(t.workspaceId),
    check("webhook_endpoints_mode_check", oneOf(t.mode, KEY_MODES)),
  ],
);

// ---------------------------------------------------------------- import pipeline

export const uploads = pgTable(
  "uploads",
  {
    id: text("id").primaryKey(), // upl_…
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    storageKey: text("storage_key").notNull(),
    filename: text("filename").notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    declaredMime: text("declared_mime"),
    // no FK: imports.upload_id already covers integrity, and a two-way FK cycle
    // between uploads and imports would complicate migrations for nothing
    consumedByImportId: text("consumed_by_import_id"),
    deleteAfter: timestamp("delete_after", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("uploads_delete_after_idx").on(t.deleteAfter)],
);

export const imports = pgTable(
  "imports",
  {
    id: text("id").primaryKey(), // imp_…
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    schemaId: text("schema_id")
      .notNull()
      .references(() => schemas.id, { onDelete: "restrict" }),
    uploadId: text("upload_id")
      .notNull()
      .unique()
      .references(() => uploads.id, { onDelete: "restrict" }),
    schemaVersion: integer("schema_version").notNull(), // pinned at creation
    endUserOrg: text("end_user_org"), // embed-token claim
    status: text("status", { enum: IMPORT_STATUSES }).notNull().default("created"),
    failureReason: jsonb("failure_reason").$type<FailureReason>(),

    // policies snapshotted from the schema (SDK may override per-embed)
    validationPolicy: text("validation_policy", { enum: VALIDATION_POLICIES }).notNull(),
    duplicatePolicy: text("duplicate_policy", { enum: DUPLICATE_POLICIES }).notNull(),

    // parse metadata
    delimiter: text("delimiter"),
    encoding: text("encoding"),
    headers: jsonb("headers").$type<string[]>(),
    columnSamples: jsonb("column_samples").$type<string[][]>(), // ≤5 per column, 80-char capped

    // mapping
    proposedMapping: jsonb("proposed_mapping").$type<MappingEntry[]>(),
    confirmedMapping: jsonb("confirmed_mapping").$type<MappingEntry[]>(),
    mappingSource: text("mapping_source", { enum: MAPPING_SOURCES }),

    // counters — Redis is live, flushed here on every state transition
    rowCount: integer("row_count").notNull().default(0),
    validCount: integer("valid_count").notNull().default(0),
    invalidCount: integer("invalid_count").notNull().default(0),
    excludedCount: integer("excluded_count").notNull().default(0),
    deliveredCount: integer("delivered_count").notNull().default(0),
    acceptedCount: integer("accepted_count").notNull().default(0),
    rejectedCount: integer("rejected_count").notNull().default(0),

    // crash-safe resume cursors
    lastParsedRow: integer("last_parsed_row").notNull().default(0),
    lastValidatedRow: integer("last_validated_row").notNull().default(0),
    lastDeliveredBatch: integer("last_delivered_batch").notNull().default(0),

    errorSummary: jsonb("error_summary").$type<ErrorSummaryEntry[]>(),
    errorReportKey: text("error_report_key"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("imports_workspace_created_idx").on(t.workspaceId, t.createdAt.desc()),
    // partial: only transient states — the reconciler cron scans a tiny index
    index("imports_transient_status_idx")
      .on(t.status)
      .where(oneOf(t.status, TRANSIENT_IMPORT_STATUSES)),
    check("imports_status_check", oneOf(t.status, IMPORT_STATUSES)),
    check("imports_validation_policy_check", oneOf(t.validationPolicy, VALIDATION_POLICIES)),
    check("imports_duplicate_policy_check", oneOf(t.duplicatePolicy, DUPLICATE_POLICIES)),
    check("imports_mapping_source_check", oneOf(t.mappingSource, MAPPING_SOURCES)),
  ],
);

export const importRows = pgTable(
  "import_rows",
  {
    importId: text("import_id")
      .notNull()
      .references(() => imports.id, { onDelete: "restrict" }),
    rowNo: integer("row_no").notNull(), // 1-based file order
    workspaceId: text("workspace_id").notNull(), // tenancy rule + future partition key
    raw: jsonb("raw").$type<(string | null)[]>().notNull(), // array aligned to imports.headers
    data: jsonb("data").$type<Record<string, unknown>>(), // mapped+transformed, set by validate
    status: text("status", { enum: ROW_STATUSES }).notNull().default("staged"),
    errors: jsonb("errors").$type<RowError[]>(),
    dedupHash: bytea("dedup_hash"), // sha256 over normalized unique-field values
    batchNo: integer("batch_no"), // assigned when packed for delivery
    edited: boolean("edited").notNull().default(false), // inline PATCH fix applied
    // deliberately no timestamps — hottest table, import row carries all timing
  },
  (t) => [
    primaryKey({ columns: [t.importId, t.rowNo] }), // idempotent parse upserts
    index("import_rows_status_idx").on(t.importId, t.status, t.rowNo),
    index("import_rows_dedup_idx")
      .on(t.importId, t.dedupHash)
      .where(sql`${t.dedupHash} is not null`),
    index("import_rows_batch_idx")
      .on(t.importId, t.batchNo)
      .where(sql`${t.batchNo} is not null`),
    check("import_rows_status_check", oneOf(t.status, ROW_STATUSES)),
  ],
);

export const importEvents = pgTable(
  "import_events",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    importId: text("import_id")
      .notNull()
      .references(() => imports.id, { onDelete: "restrict" }),
    workspaceId: text("workspace_id").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    actor: text("actor", { enum: EVENT_ACTORS }).notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [
    index("import_events_import_idx").on(t.importId, t.id),
    check("import_events_actor_check", oneOf(t.actor, EVENT_ACTORS)),
  ],
);

export const mappingCache = pgTable(
  "mapping_cache",
  {
    id: text("id").primaryKey(), // mc_…
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    schemaId: text("schema_id")
      .notNull()
      .references(() => schemas.id, { onDelete: "restrict" }),
    schemaVersion: integer("schema_version").notNull(),
    headerSignature: text("header_signature").notNull(), // sha256 of normalized headers
    mapping: jsonb("mapping").$type<MappingEntry[]>().notNull(),
    source: text("source", { enum: CACHE_SOURCES }).notNull(), // human overrides upgrade the entry
    hitCount: integer("hit_count").notNull().default(0),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("mapping_cache_lookup_uq").on(t.schemaId, t.schemaVersion, t.headerSignature),
    check("mapping_cache_source_check", oneOf(t.source, CACHE_SOURCES)),
  ],
);

// ---------------------------------------------------------------- delivery & observability

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: text("id").primaryKey(), // whd_…
    workspaceId: text("workspace_id").notNull(),
    importId: text("import_id")
      .notNull()
      .references(() => imports.id, { onDelete: "restrict" }),
    endpointId: text("endpoint_id")
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: "restrict" }),
    type: text("type", { enum: DELIVERY_TYPES }).notNull(),
    batchNo: integer("batch_no"), // rows.batch only
    idempotencyKey: text("idempotency_key").notNull(), // 'imp_x:12'
    // inline ONLY for small events; rows.batch payloads are rebuilt from import_rows
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    status: text("status", { enum: DELIVERY_STATUSES }).notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("webhook_deliveries_idem_uq").on(t.endpointId, t.idempotencyKey),
    index("webhook_deliveries_workspace_idx").on(t.workspaceId, t.createdAt.desc()),
    index("webhook_deliveries_import_idx").on(t.importId),
    check("webhook_deliveries_type_check", oneOf(t.type, DELIVERY_TYPES)),
    check("webhook_deliveries_status_check", oneOf(t.status, DELIVERY_STATUSES)),
  ],
);

export const webhookDeliveryAttempts = pgTable(
  "webhook_delivery_attempts",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    deliveryId: text("delivery_id")
      .notNull()
      .references(() => webhookDeliveries.id, { onDelete: "restrict" }),
    attemptNo: integer("attempt_no").notNull(),
    responseStatus: integer("response_status"),
    responseBody: text("response_body"), // truncated to 4 KB at write time
    error: text("error"),
    durationMs: integer("duration_ms"),
    createdAt: createdAt(),
  },
  (t) => [index("webhook_delivery_attempts_delivery_idx").on(t.deliveryId, t.attemptNo)],
);

export const aiCalls = pgTable(
  "ai_calls",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    importId: text("import_id")
      .notNull()
      .references(() => imports.id, { onDelete: "restrict" }),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    latencyMs: integer("latency_ms"),
    outcome: text("outcome", { enum: AI_OUTCOMES }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    // daily budget check = indexed count since midnight
    index("ai_calls_workspace_created_idx").on(t.workspaceId, t.createdAt),
    check("ai_calls_outcome_check", oneOf(t.outcome, AI_OUTCOMES)),
  ],
);

export const usageCounters = pgTable(
  "usage_counters",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    period: date("period").notNull(), // first of month
    rowsImported: bigint("rows_imported", { mode: "number" }).notNull().default(0),
    importsCompleted: integer("imports_completed").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.period] })],
);
