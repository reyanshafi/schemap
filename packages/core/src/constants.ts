// Status vocabularies — single source of truth for DB CHECK constraints,
// Drizzle column typing, and Zod validation (docs/03 §1).

export const PLANS = ["free", "starter", "growth"] as const;
export type Plan = (typeof PLANS)[number];

export const KEY_MODES = ["test", "live"] as const;
export type KeyMode = (typeof KEY_MODES)[number];

export const MEMBER_ROLES = ["owner", "admin", "member"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const VALIDATION_POLICIES = [
  "reject_file",
  "import_valid_only",
  "require_all_valid",
] as const;
export type ValidationPolicy = (typeof VALIDATION_POLICIES)[number];

export const DUPLICATE_POLICIES = [
  "keep_first",
  "keep_last",
  "exclude_all",
  "abort",
] as const;
export type DuplicatePolicy = (typeof DUPLICATE_POLICIES)[number];

export const IMPORT_STATUSES = [
  "created",
  "parsing",
  "mapping",
  "awaiting_review",
  "validating",
  "awaiting_confirm",
  "importing",
  "completed",
  "failed",
  "rolling_back",
  "rolled_back",
  "cancelled",
] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

// states a worker owns; the reconciler cron re-enqueues imports stuck here
export const TRANSIENT_IMPORT_STATUSES = [
  "parsing",
  "mapping",
  "validating",
  "importing",
  "rolling_back",
] as const;

export const ROW_STATUSES = [
  "staged",
  "valid",
  "invalid",
  "excluded",
  "delivered",
  "accepted",
  "rejected",
] as const;
export type RowStatus = (typeof ROW_STATUSES)[number];

export const MAPPING_SOURCES = ["cache", "ai", "fallback"] as const;
export type MappingSource = (typeof MAPPING_SOURCES)[number];

export const CACHE_SOURCES = ["ai", "human"] as const;
export type CacheSource = (typeof CACHE_SOURCES)[number];

export const EVENT_ACTORS = ["system", "end_user", "developer_api", "dashboard"] as const;
export type EventActor = (typeof EVENT_ACTORS)[number];

export const DELIVERY_TYPES = ["rows.batch", "import.completed", "import.rollback"] as const;
export type DeliveryType = (typeof DELIVERY_TYPES)[number];

export const DELIVERY_STATUSES = ["pending", "succeeded", "failed", "exhausted"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const AI_OUTCOMES = ["ok", "invalid_json_retried", "fallback_used"] as const;
export type AiOutcome = (typeof AI_OUTCOMES)[number];

export const FIELD_TYPES = [
  "string",
  "number",
  "boolean",
  "date",
  "email",
  "phone",
  "enum",
  "custom_regex",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

// pipeline limits (PRD §6.1 / §8)
export const LIMITS = {
  maxFileBytes: 100 * 1024 * 1024, // 100 MB
  maxRowsPerImport: 250_000,
  previewRows: 100,
  samplesPerColumn: 5,
  sampleMaxChars: 80,
  deliveryBatchSize: 500,
  stagingWriteBatchSize: 1_000,
} as const;
